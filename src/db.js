class AccessPoint {
    constructor(id, x, y, levelId) {
        this.id = id
        this.x = x
        this.y = y
        this.levelId = levelId
    }
}

class DeviceReading {
    constructor(id, name, signals, date, levelId) {
        this.id = id
        this.name = name
        this.signals = signals
        this.date = date
        this.levelId = levelId
    }
}

class Room {
    constructor(id, name, x, y, width, height, levelId) {
        this.id = id
        this.name = name
        this.x = x
        this.y = y
        this.width = width
        this.height = height
        this.levelId = levelId
    }
}

class Level {
    constructor(id, name, floorNumber) {
        this.id = id
        this.name = name
        this.floorNumber = floorNumber
    }
}

export const levels = [
    new Level('L001', 'Ground Floor', 0),
    new Level('L002', 'First Floor', 1),
    new Level('L003', 'Second Floor', 2)
]

export const accessPoints = [
    // Ground Floor - 5 APs
    new AccessPoint('AP000001', 100, 100, 'L001'),
    new AccessPoint('AP000002', 100, 500, 'L001'),
    new AccessPoint('AP000003', 600, 100, 'L001'),
    new AccessPoint('AP000004', 600, 500, 'L001'),
    new AccessPoint('AP000005', 1600, 300, 'L001'),
    // First Floor - 6 APs
    new AccessPoint('AP000006', 100, 100, 'L002'),
    new AccessPoint('AP000007', 100, 500, 'L002'),
    new AccessPoint('AP000008', 850, 100, 'L002'),
    new AccessPoint('AP000009', 850, 500, 'L002'),
    new AccessPoint('AP000010', 1600, 100, 'L002'),
    new AccessPoint('AP000011', 1600, 500, 'L002'),
    // Second Floor - 4 APs
    new AccessPoint('AP000012', 100, 100, 'L003'),
    new AccessPoint('AP000013', 100, 500, 'L003'),
    new AccessPoint('AP000014', 1000, 300, 'L003'),
    new AccessPoint('AP000015', 1400, 300, 'L003')
]


export const rooms = [
    // Ground Floor
    new Room('R001', 'Pantry', 100, 100, 500, 400, 'L001'),
    new Room('R002', 'Meeting Room', 600, 100, 500, 400, 'L001'),
    new Room('R003', 'Office', 1100, 100, 500, 400, 'L001'),
    // First Floor
    new Room('R004', 'Conference Room', 100, 100, 600, 400, 'L002'),
    new Room('R005', 'Executive Office', 700, 100, 400, 400, 'L002'),
    new Room('R006', 'Break Room', 1100, 100, 500, 400, 'L002'),
    new Room('R007', 'Training Room', 100, 500, 700, 300, 'L002'),
    // Second Floor
    new Room('R008', 'Server Room', 100, 100, 400, 400, 'L003'),
    new Room('R009', 'IT Office', 500, 100, 500, 400, 'L003'),
    new Room('R010', 'Storage', 1000, 100, 400, 400, 'L003')
]

export const deviceReadings = []
