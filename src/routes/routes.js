import express from 'express'
import { accessPoints, deviceReadings, rooms, levels } from '../db.js'

const router = express.Router()

router.get('/levels', (req, res) => {
    res.json(levels)
})

router.get('/access-points', (req, res) => {
    const { levelId } = req.query
    if (levelId) {
        const filtered = accessPoints.filter(ap => ap.levelId === levelId)
        res.json(filtered)
    } else {
        res.json(accessPoints)
    }
})

router.post('/device-readings', (req, res) => {
    const { id, name, signals, date, levelId } = req.body
    if (!id || !signals || !date || !levelId) {
        return res.status(400).send('Invalid device reading data')
    }
    const newReading = { id, name, signals, date, levelId }
    deviceReadings.push(newReading)
    res.sendStatus(201)
})

router.put('/device-readings', (req, res) => {
    const { id, name, signals, date, levelId } = req.body
    if (!id || !signals || !date || !levelId) {
        return res.status(400).send('Invalid device reading data')
    }
    const index = deviceReadings.findIndex(d => d.id === id)
    if (index === -1) {
        deviceReadings.push({ id, name, signals, date, levelId })
        return res.sendStatus(201)
    }
    deviceReadings[index] = { id, name, signals, date, levelId }
    res.status(200).json({ message: 'Device reading updated' })
})

router.get('/device-readings', (req, res) => {
    const { levelId } = req.query
    if (levelId) {
        const filtered = deviceReadings.filter(reading => reading.levelId === levelId)
        res.json(filtered)
    } else {
        res.json(deviceReadings)
    }
})

router.get('/rooms', (req, res) => {
    const { levelId } = req.query
    if (levelId) {
        const filtered = rooms.filter(room => room.levelId === levelId)
        res.json(filtered)
    } else {
        res.json(rooms)
    }
})

export default router