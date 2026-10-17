// pages/api/horses/index.ts
import type { NextApiRequest, NextApiResponse } from 'next'

import { withAuth } from '@/lib/withAuth'
import { hasFeaturePermission } from '@/lib/permissions'
import { rememberJson } from '@/lib/cache'
import {
  cacheKeys,
  CACHE_TTL_SECONDS,
  invalidateHorseCaches,
} from '@/lib/cacheKeys'
import prisma from '@/lib/prisma'
import { uploadBase64Image } from '@/lib/s3'
import {
  sanitizeString,
  isValidString,
  isOneOf,
  safeDate,
  isValidPhone,
  validateBase64Image,
  safePositiveInt,
} from '@/lib/validate'
import { resolveLookupId } from '@/lib/lookups'

const HORSE_GENDER_OPTIONS = [
  'Stallion',
  'Mare',
  'Gelding',
  'Colt',
  'Filly',
  'Foal',
  'Stud',
  'Male',
  'Female',
] as const

const HORSE_ENTRY_TYPE_OPTIONS = ['Normal', 'Private'] as const

export default withAuth(async (req: NextApiRequest, res: NextApiResponse, decoded) => {

  switch (req.method) {
    case 'GET':
      return handleGetHorses(req, res, decoded)
    case 'POST':
      return handleCreateHorse(req, res, decoded)
    default:
      return res.status(405).json({ error: 'Method not allowed' })
  }})

async function handleGetHorses(req: NextApiRequest, res: NextApiResponse, decoded: { id: string; designation: string }) {
  try {
    if (!(await hasFeaturePermission(decoded.designation, 'horses.view', decoded.id))) {
      return res.status(403).json({ error: 'You do not have permission to view horses' })
    }

    const { status, skip = 0, take = 1000, search } = req.query

    const statusValue = Array.isArray(status) ? status[0] : status
    const searchValue = Array.isArray(search) ? search[0] : search
    const parsedSkip = safePositiveInt(skip, 0)
    const parsedTake = safePositiveInt(take, 1000, 1000)
    const safeStatus = statusValue ? String(statusValue).slice(0, 50) : null
    const safeSearch =
      searchValue && searchValue.trim().length > 0
        ? String(searchValue).slice(0, 100)
        : null

    const response = await rememberJson(
      cacheKeys.horsesList({
        status: safeStatus,
        skip: parsedSkip,
        take: parsedTake,
        search: safeSearch,
      }),
      CACHE_TTL_SECONDS.horsesList,
      async () => {
        const where: {
          status?: string
          OR?: Array<Record<string, unknown>>
        } = {}

        if (safeStatus) {
          where.status = safeStatus
        }

        if (safeSearch) {
          where.OR = [
            { name: { contains: safeSearch, mode: 'insensitive' } },
            { breed: { contains: safeSearch, mode: 'insensitive' } },
            { stableNumber: { contains: safeSearch, mode: 'insensitive' } },
            { ownerName: { contains: safeSearch, mode: 'insensitive' } },
            { ownerContact: { contains: safeSearch, mode: 'insensitive' } },
          ]
        }

        const [horses, total] = await Promise.all([
          prisma.horse.findMany({
            where,
            skip: parsedSkip,
            take: parsedTake,
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              name: true,
              gender: true,
              dateOfBirth: true,
              horseEntryType: true,
              breed: true,
              color: true,
              height: true,
              age: true,
              stableNumber: true,
              profileImage: true,
              status: true,
              discipline: true,
              trainingLevel: true,
              workloadLimit: true,
              location: true,
              ownerName: true,
              ownerContact: true,
              privateEntryAt: true,
              privateExitAt: true,
              passportNumber: true,
              supervisorId: true,
              createdAt: true,
              updatedAt: true,
              supervisor: {
                select: { id: true, fullName: true, designation: true },
              },
            },
          }),
          prisma.horse.count({ where }),
        ])

        return {
          data: horses,
          pagination: { total, skip, take },
        }
      }
    )

    return res.status(200).json(response)
  } catch (error) {
    console.error('Error fetching horses:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

async function handleCreateHorse(
  req: NextApiRequest,
  res: NextApiResponse,
  decoded: { id: string; designation: string }
) {
  try {
    if (!(await hasFeaturePermission(decoded.designation, 'horses.create', decoded.id))) {
      return res.status(403).json({ error: 'You do not have permission to add horses' })
    }
    const {
      name,
      gender,
      dateOfBirth,
      horseEntryType,
      breed,
      color,
      height,
      stableNumber,
      supervisorId,
      status,
      profileImage,
      passportNumber,
      ownerName,
      ownerPhone,
      entryTimestamp,
      exitTimestamp,
    } = req.body

    if (!isValidString(name, 1, 100)) {
      return res.status(400).json({ error: 'Name is required (max 100 chars)' })
    }
    if (!isOneOf(gender, HORSE_GENDER_OPTIONS)) {
      return res.status(400).json({ error: 'Invalid gender' })
    }
    const normalizedEntryType = horseEntryType || 'Normal'
    if (!isOneOf(normalizedEntryType, HORSE_ENTRY_TYPE_OPTIONS)) {
      return res.status(400).json({ error: 'Invalid horse entry type' })
    }
    const dob = safeDate(dateOfBirth)
    if (!dob) {
      return res.status(400).json({ error: 'Valid date of birth is required' })
    }
    if (!isValidString(breed, 1, 100)) {
      return res.status(400).json({ error: 'Breed is required (max 100 chars)' })
    }
    if (color && !isValidString(color, 0, 50)) {
      return res.status(400).json({ error: 'Color must be max 50 chars' })
    }
    if (height !== undefined && height !== null) {
      const parsedHeight = parseFloat(height)
      if (isNaN(parsedHeight) || parsedHeight < 0 || parsedHeight > 25) {
        return res.status(400).json({ error: 'Height must be between 0 and 25' })
      }
    }
    if (stableNumber && !isValidString(stableNumber, 0, 20)) {
      return res
        .status(400)
        .json({ error: 'Stable number must be max 20 chars' })
    }
    if (
      status &&
      !isOneOf(status, [
        'Active',
        'Inactive',
        'Retired',
        'Deceased',
        'Sold',
        'Transferred',
      ] as const)
    ) {
      return res.status(400).json({ error: 'Invalid status' })
    }

    if (passportNumber && passportNumber.trim().length > 0) {
      const passportRegex = /^[A-Za-z0-9][A-Za-z0-9\s\-\/]{1,49}$/
      if (!passportRegex.test(passportNumber.trim())) {
        return res.status(400).json({
          error:
            'Invalid passport number format. Use alphanumeric characters, hyphens, and forward slashes (3-50 characters).',
        })
      }
    }

    const privateEntryAt = safeDate(entryTimestamp)
    const privateExitAt = safeDate(exitTimestamp)

    if (normalizedEntryType === 'Private') {
      if (!isValidString(ownerName, 1, 100)) {
        return res.status(400).json({ error: 'Owner name is required for private horses' })
      }
      if (!isValidPhone(ownerPhone)) {
        return res.status(400).json({ error: 'Valid owner phone number is required for private horses' })
      }
      if (!privateEntryAt) {
        return res.status(400).json({ error: 'Entry timestamp is required for private horses' })
      }
      if (exitTimestamp && !privateExitAt) {
        return res.status(400).json({ error: 'Exit timestamp must be a valid date/time' })
      }
      if (privateExitAt && privateExitAt < privateEntryAt) {
        return res.status(400).json({ error: 'Exit timestamp cannot be earlier than entry timestamp' })
      }
    }

    let imageUrl: string | null = null
    if (profileImage && typeof profileImage === 'string' && profileImage.length > 0) {
      const imgCheck = validateBase64Image(profileImage, 5 * 1024 * 1024)
      if (!imgCheck.valid) {
        return res.status(400).json({ error: imgCheck.reason })
      }
      imageUrl = await uploadBase64Image(profileImage, 'profiles/horses')
    }

    const sanitizedBreed = sanitizeString(breed)
    const sanitizedColor = color ? sanitizeString(color) : null
    const horseStatus = status || 'Active'
    const [statusId, genderId, horseEntryTypeId, breedId, colorId] = await Promise.all([
      resolveLookupId('horse-status', horseStatus),
      resolveLookupId('horse-gender', gender),
      resolveLookupId('horse-entry-type', normalizedEntryType),
      resolveLookupId('horse-breed', sanitizedBreed),
      resolveLookupId('horse-color', sanitizedColor),
    ])

    const horse = await prisma.horse.create({
      data: {
        name: sanitizeString(name),
        gender,
        genderId,
        dateOfBirth: dob,
        horseEntryType: normalizedEntryType,
        horseEntryTypeId,
        breed: sanitizedBreed,
        breedId,
        color: sanitizedColor,
        colorId,
        height: height ? parseFloat(height) : null,
        stableNumber: stableNumber ? sanitizeString(stableNumber) : null,
        ownerName:
          normalizedEntryType === 'Private' ? sanitizeString(ownerName) : null,
        ownerContact:
          normalizedEntryType === 'Private' ? sanitizeString(ownerPhone) : null,
        privateEntryAt: normalizedEntryType === 'Private' ? privateEntryAt : null,
        privateExitAt:
          normalizedEntryType === 'Private' ? privateExitAt || null : null,
        supervisorId: supervisorId || null,
        status: horseStatus,
        statusId,
        profileImage: imageUrl,
        passportNumber:
          passportNumber && passportNumber.trim().length > 0
            ? passportNumber.trim().toUpperCase()
            : null,
      },
      include: {
        supervisor: true,
      },
    })

    await invalidateHorseCaches()

    return res.status(201).json(horse)
  } catch (error) {
    console.error('Error creating horse:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
