import express from 'express'
import path, { dirname } from 'path'
import { fileURLToPath } from 'url'
import { accessPoints, deviceReadings } from './db.js'
import routes from './routes/routes.js'

const app = express()
const PORT = process.env.PORT || 8383

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

app.use(express.static(path.join(__dirname, '../public')))
app.use(express.json())

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

// Routes
app.use('/', routes)

app.listen(PORT, () => { 
    console.log(`Server has started on ${PORT}`) 
})