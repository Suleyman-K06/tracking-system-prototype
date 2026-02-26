// Constants
const API_BASE = 'http://localhost:8383';
const DEFAULT_POSITION = { x: 200, y: 200 };
const DISTANCE_SCALE = 50;
const RSSI_TX_POWER = -45;
const PATH_LOSS_EXPONENT = 2.2;

// Global state
let deviceVisibility = {};
let currentLevelId = null;

// Data Fetching
async function fetchAccessPoints(levelId) {
    return d3.json(`${API_BASE}/access-points${levelId ? `?levelId=${levelId}` : ''}`);
}

async function fetchDeviceReadings(levelId) {
    return d3.json(`${API_BASE}/device-readings${levelId ? `?levelId=${levelId}` : ''}`);
}

async function fetchRooms(levelId) {
    return d3.json(`${API_BASE}/rooms${levelId ? `?levelId=${levelId}` : ''}`);
}

async function fetchLevels() {
    return d3.json(`${API_BASE}/levels`);
}

// Utility Functions
function rssiToDistance(rssi, tx = RSSI_TX_POWER, n = PATH_LOSS_EXPONENT) {
    return Math.pow(10, (tx - rssi) / (10 * n)) * DISTANCE_SCALE;
}

function getRoomForPosition(x, y, rooms) {
    for (const room of rooms) {
        if (x >= room.x && x <= room.x + room.width && y >= room.y && y <= room.y + room.height) {
            return room.name;
        }
    }
    return "Outside";
}

function trilaterate(p1, p2, p3) {
    const { x: xa, y: ya, d: ra } = p1;
    const { x: xb, y: yb, d: rb } = p2;
    const { x: xc, y: yc, d: rc } = p3;

    const A = 2 * (xa - xb);
    const B = 2 * (ya - yb);
    const C = rb * rb - ra * ra - xb * xb + xa * xa - yb * yb + ya * ya;
    const D = 2 * (xa - xc);
    const E = 2 * (ya - yc);
    const F = rc * rc - ra * ra - xc * xc + xa * xa - yc * yc + ya * ya;

    const denom = A * E - B * D;
    if (Math.abs(denom) < 1e-6) return null;

    return {
        x: (C * E - B * F) / denom,
        y: (A * F - C * D) / denom
    };
}

function computeDevicePosition(accessPoints, signals, rooms) {
    if (signals.length < 3) return null;

    // Filter signals to only those with access points in the current level
    const validSignals = signals.filter(s => accessPoints.find(ap => ap.id === s.apId));
    if (validSignals.length < 3) return null;

    const points = validSignals.map(s => {
        const ap = accessPoints.find(a => a.id === s.apId);
        return { x: ap.x, y: ap.y, d: rssiToDistance(s.rssi) };
    });

    const pos = trilaterate(points[0], points[1], points[2]);
    if (!pos) return null;

    // Check if the position is inside any room
    if (getRoomForPosition(pos.x, pos.y, rooms) === "Outside") {
        return null; // Hide device if position is outside all rooms
    }

    return pos;
}

function filterReadingsByLevel(readings, levelId) {
    return readings.filter(r => r.levelId == levelId);
}

function getLatestReadings(readings) {
    const latest = {};
    readings.forEach(reading => {
        if (!latest[reading.id] || new Date(reading.date) > new Date(latest[reading.id].date)) {
            latest[reading.id] = reading;
        }
    });
    return Object.values(latest);
}

// Visualization Functions
function drawRooms(g, rooms) {
    g.selectAll('rect.room')
        .data(rooms)
        .enter()
        .append('rect')
        .attr('class', 'room')
        .attr('x', d => d.x)
        .attr('y', d => d.y)
        .attr('width', d => d.width)
        .attr('height', d => d.height)
        .attr('fill', 'none')
        .attr('stroke', '#d2d2d7')
        .attr('stroke-width', 2);

    g.selectAll('text.room-label')
        .data(rooms)
        .enter()
        .append('text')
        .attr('class', 'room-label')
        .attr('x', d => d.x + d.width / 2)
        .attr('y', d => d.y + d.height / 2)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('fill', '#1d1d1f')
        .text(d => d.name);
}

function drawAccessPoints(g, accessPoints) {
    g.selectAll('circle.ap')
        .data(accessPoints)
        .enter()
        .append('circle')
        .attr('class', 'ap')
        .attr('cx', d => d.x)
        .attr('cy', d => d.y)
        .attr('r', 8)
        .attr('fill', '#0071e3');

    g.selectAll('text.ap-label')
        .data(accessPoints)
        .enter()
        .append('text')
        .attr('x', d => d.x + 10)
        .attr('y', d => d.y - 10)
        .attr('fill', '#1d1d1f')
        .text(d => d.id)
        .attr('font-size', '12px');
}

// Sidebar Functions
function initSidebarToggle() {
    const sidebar = document.getElementById('sidebar');
    const toggle = document.getElementById('sidebarToggle');
    const openIcon = document.querySelector('.open-icon');
    const closeIcon = document.querySelector('.close-icon');

    toggle.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        if (sidebar.classList.contains('collapsed')) {
            openIcon.style.display = 'none';
            closeIcon.style.display = 'block';
        } else {
            openIcon.style.display = 'block';
            closeIcon.style.display = 'none';
        }
    });
}

function initLevelSelector(levels) {
    const levelList = document.getElementById('levelList');
    levelList.innerHTML = '';

    levels.forEach(level => {
        const levelItem = document.createElement('div');
        levelItem.className = 'level-item';
        levelItem.dataset.levelId = level.id;

        if (level.id === currentLevelId) {
            levelItem.classList.add('active');
        }

        levelItem.innerHTML = `
            <div class="level-item-number">${level.floorNumber}</div>
            <div class="level-item-name">${level.name}</div>
        `;

        levelItem.addEventListener('click', async () => {
            document.querySelectorAll('.level-item').forEach(item => item.classList.remove('active'));
            levelItem.classList.add('active');
            currentLevelId = level.id;
            await switchLevel(currentLevelId);
        });

        levelList.appendChild(levelItem);
    });
}

async function switchLevel(levelId) {
    try {
        const [aps, allReads, reads, rooms] = await Promise.all([
            fetchAccessPoints(levelId),
            fetchDeviceReadings(),
            fetchDeviceReadings(levelId),
            fetchRooms(levelId)
        ]);

        const { innerWidth: width, innerHeight: height } = window;

        window.accessPoints = aps;
        window.rooms = rooms;
        window.currentLevelId = levelId;

        // Update active level in picker
        document.querySelectorAll('.level-item').forEach(item => {
            item.classList.remove('active');
            if (item.dataset.levelId == levelId) {
                item.classList.add('active');
            }
        });

        // Filter readings to only those for the current level
        const filteredReads = filterReadingsByLevel(reads, levelId);

        // Clear and redraw
        window.zoomGroup.selectAll('*').remove();
        drawRooms(window.zoomGroup, rooms);
        drawAccessPoints(window.zoomGroup, aps);
        updateSidebar(allReads);
        updateDevicePlot(window.zoomGroup, filteredReads, aps, width - 200, height, rooms);
    } catch (error) {
        console.error('Error switching level:', error);
    }
}

function updateSidebar(readings) {
    const devices = getLatestReadings(readings).sort((a, b) => a.name.localeCompare(b.name));

    const deviceList = document.getElementById('deviceList');
    deviceList.innerHTML = '';

    devices.forEach(device => {
        if (deviceVisibility[device.id] === undefined) {
            deviceVisibility[device.id] = true;
        }

        const deviceItem = document.createElement('div');
        deviceItem.className = 'device-item';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `device-${device.id}`;
        checkbox.checked = deviceVisibility[device.id];
        checkbox.addEventListener('change', async (e) => {
            deviceVisibility[device.id] = e.target.checked;
            const { innerWidth: width, innerHeight: height } = window;
            const searchTerm = document.getElementById('deviceSearch').value.toLowerCase();
            const [allReads, currentReadsRaw] = await Promise.all([
                fetchDeviceReadings(),
                fetchDeviceReadings(window.currentLevelId)
            ]);
            const currentReads = filterReadingsByLevel(currentReadsRaw, window.currentLevelId);
            updateDevicePlot(window.zoomGroup, currentReads, window.accessPoints, width - 200, height, window.rooms, searchTerm);
            updateSidebar(allReads);
        });

        const label = document.createElement('label');
        label.htmlFor = `device-${device.id}`;
        label.textContent = `${device.name} (${device.id})`;

        deviceItem.appendChild(checkbox);
        deviceItem.appendChild(label);
        deviceList.appendChild(deviceItem);
    });
}

// Device Plotting
function updateDevicePlot(g, readings, accessPoints, width, height, rooms, searchTerm = '') {
    g.selectAll('g.device').remove();

    const deviceData = getLatestReadings(readings).filter(device => deviceVisibility[device.id] !== false);

    const deviceGroup = g.selectAll('g.device')
        .data(deviceData)
        .enter()
        .append('g')
        .attr('class', 'device');

    deviceGroup.append('circle')
        .attr('class', 'device')
        .attr('r', 18)
        .attr('fill', '#f5f5f7')
        .attr('stroke', '#1d1d1f')
        .attr('stroke-width', 1)
        .attr('cx', d => computeDevicePosition(accessPoints, d.signals, rooms)?.x || DEFAULT_POSITION.x)
        .attr('cy', d => computeDevicePosition(accessPoints, d.signals, rooms)?.y || DEFAULT_POSITION.y)
        .on('mouseover', function(event, d) {
            d3.select(this)
                .transition()
                .duration(300)
                .attr('r', 24);
            const pos = computeDevicePosition(accessPoints, d.signals, rooms) || DEFAULT_POSITION;
            const room = getRoomForPosition(pos.x, pos.y, rooms);
            const svgRect = d3.select('#canvas').node().getBoundingClientRect();
            const transform = d3.zoomTransform(g.node());
            const circleX = svgRect.left + (pos.x * transform.k + transform.x);
            const circleY = svgRect.top + (pos.y * transform.k + transform.y);
            const tooltip = d3.select('#tooltip')
                .style('display', 'block')
                .style('opacity', 0)
                .style('left', `${circleX}px`)
                .style('top', `${circleY}px`)
                .style('transform', 'translateX(-50%)')
                .html(`<strong>${d.name}</strong><br>Room: ${room}<br>${d.signals.map(s => `${s.apId}: ${s.rssi}`).join('<br>')}`)
                .transition()
                .duration(300)
                .style('opacity', 1);
        })
        .on('mouseout', function() {
            d3.select(this)
                .transition()
                .duration(300)
                .attr('r', 18);
            d3.select('#tooltip')
                .transition()
                .duration(300)
                .style('opacity', 0)
                .on('end', function() {
                    d3.select(this).style('display', 'none');
                });
        });

    deviceGroup.append('text')
        .attr('class', 'device-label')
        .attr('x', d => computeDevicePosition(accessPoints, d.signals, rooms)?.x || DEFAULT_POSITION.x)
        .attr('y', d => (computeDevicePosition(accessPoints, d.signals, rooms)?.y || DEFAULT_POSITION.y) + 4)
        .attr('text-anchor', 'middle')
        .attr('font-size', '10px')
        .attr('fill', '#1d1d1f')
        .attr('font-weight', 'bold')
        .style('pointer-events', 'none')
        .style('user-select', 'none')
        .text(d => d.name);

    if (searchTerm) {
        highlightDevice(searchTerm, g, readings, accessPoints, rooms);
    }
}

function highlightDevice(searchTerm, g, readings, accessPoints, rooms) {
    g.selectAll('circle.device')
        .attr('fill', '#f5f5f7')
        .attr('stroke', '#1d1d1f')
        .attr('stroke-width', 1)
        .attr('r', 18);

    if (searchTerm === '') return;

    const matchingDevices = getLatestReadings(readings).filter(device =>
        device.name.toLowerCase().includes(searchTerm) ||
        device.id.toLowerCase().includes(searchTerm)
    );

    matchingDevices.forEach(device => {
        const deviceCircle = g.selectAll('circle.device')
            .filter(d => d.id === device.id);

        deviceCircle
            .attr('fill', '#60a5fa')
            .attr('stroke', '#3b82f6')
            .attr('stroke-width', 3)
            .attr('r', 22);
    });
}

// Simulation
function simulateDeviceReadings(accessPoints, levelId) {
    const devices = [
        { id: 'DEV001', name: 'John' },
        { id: 'DEV002', name: 'Alice' },
        { id: 'DEV003', name: 'Bob' },
        { id: 'DEV004', name: 'Charlie' },
        { id: 'DEV005', name: 'David' },
        { id: 'DEV006', name: 'Eva' },
        { id: 'DEV007', name: 'Frank' },
        { id: 'DEV008', name: 'Grace' }
    ];
    const randomDevice = devices[Math.floor(Math.random() * devices.length)];

    const signals = accessPoints.map(ap => ({
        apId: ap.id,
        rssi: Math.floor(-35 - Math.random() * 45)
    })).sort((a, b) => b.rssi - a.rssi).slice(0, 3);

    return { ...randomDevice, signals, date: new Date().toISOString(), levelId };
}

// Initialization
async function initApp() {
    try {
        const levels = await fetchLevels();
        currentLevelId = levels[0].id; // Default to first level

        const [aps, allReads, reads, rooms] = await Promise.all([
            fetchAccessPoints(currentLevelId),
            fetchDeviceReadings(),
            fetchDeviceReadings(currentLevelId),
            fetchRooms(currentLevelId)
        ]);

        const { innerWidth: width, innerHeight: height } = window;

        window.accessPoints = aps;
        window.rooms = rooms;
        window.levels = levels;
        window.currentLevelId = currentLevelId;

        // Filter readings to only those for the current level
        const filteredReads = filterReadingsByLevel(reads, currentLevelId);

        // Add level selector
        initLevelSelector(levels);

        const canvas = d3.select('#canvas')
            .attr('width', width - 200) // Subtract level picker width
            .attr('height', height - 60);

        const g = canvas.append('g').attr('class', 'zoom-group');

        window.zoomGroup = g;

        const zoom = d3.zoom()
            .scaleExtent([0.1, 10])
            .on('zoom', event => {
                g.attr('transform', event.transform);
            });

        canvas.call(zoom);

        drawRooms(window.zoomGroup, rooms);
        drawAccessPoints(window.zoomGroup, aps);
        updateSidebar(allReads);
        updateDevicePlot(window.zoomGroup, filteredReads, aps, width - 200, height, rooms);

        // Event listeners
        document.getElementById('postButton').addEventListener('click', async () => {
            try {
                const randomLevel = window.levels[Math.floor(Math.random() * window.levels.length)];
                const apsForLevel = await fetchAccessPoints(randomLevel.id);
                const r = simulateDeviceReadings(apsForLevel, randomLevel.id);

                await fetch(`${API_BASE}/device-readings`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(r)
                });

                // Re-fetch readings for current level and all
                const [allReadsUpdated, updatedReadsRaw] = await Promise.all([
                    fetchDeviceReadings(),
                    fetchDeviceReadings(currentLevelId)
                ]);
                const updatedReads = filterReadingsByLevel(updatedReadsRaw, currentLevelId);

                updateDevicePlot(window.zoomGroup, updatedReads, window.accessPoints, width - 200, height, rooms);
                updateSidebar(allReadsUpdated);
            } catch (error) {
                console.error('Error posting reading:', error);
            }
        });

        initSidebarToggle();

        const searchResultEl = document.getElementById('searchResult');
        const searchInput = document.getElementById('deviceSearch');
        searchInput.addEventListener('input', async (e) => {
            try {
                const searchTerm = e.target.value.toLowerCase();
                
                if (searchTerm === '') {
                    if (searchResultEl) {
                        searchResultEl.classList.remove('show');
                        searchResultEl.innerHTML = '';
                    }
                    const currentReadsRaw = await fetchDeviceReadings(window.currentLevelId);
                    const currentReads = filterReadingsByLevel(currentReadsRaw, window.currentLevelId);
                    updateDevicePlot(window.zoomGroup, currentReads, window.accessPoints, width - 200, height, window.rooms, searchTerm);
                    return;
                }

                // Search across all devices
                const allReads = await fetchDeviceReadings();
                const allDevices = getLatestReadings(allReads);
                const matchingDevice = allDevices.find(device =>
                    device.name.toLowerCase().includes(searchTerm) ||
                    device.id.toLowerCase().includes(searchTerm)
                );

                if (matchingDevice) {
                    // Switch to the device's level
                    await switchLevel(matchingDevice.levelId);
                    
                    // Highlight the device on its level
                    const currentReadsRaw = await fetchDeviceReadings(window.currentLevelId);
                    const currentReads = filterReadingsByLevel(currentReadsRaw, window.currentLevelId);
                    updateDevicePlot(window.zoomGroup, currentReads, window.accessPoints, width - 200, height, window.rooms, searchTerm);

                    // Compute room/position and show in search result area
                    if (searchResultEl) {
                        const pos = computeDevicePosition(window.accessPoints, matchingDevice.signals || [], window.rooms) || DEFAULT_POSITION;
                        const room = getRoomForPosition(pos.x, pos.y, window.rooms);
                        const levelName = (window.levels || []).find(l => l.id == matchingDevice.levelId)?.name || matchingDevice.levelId;
                        searchResultEl.innerHTML = `<strong>${matchingDevice.name}</strong> &mdash; Level: ${levelName}, Room: ${room}`;
                        // show with class for animation
                        searchResultEl.classList.add('show');
                    }
                } else {
                    // No match found, keep current level view and hide result
                    if (searchResultEl) {
                        searchResultEl.classList.remove('show');
                        searchResultEl.innerHTML = '';
                    }
                    const currentReadsRaw = await fetchDeviceReadings(window.currentLevelId);
                    const currentReads = filterReadingsByLevel(currentReadsRaw, window.currentLevelId);
                    updateDevicePlot(window.zoomGroup, currentReads, window.accessPoints, width - 200, height, window.rooms, searchTerm);
                }
            } catch (error) {
                console.error('Error searching devices:', error);
            }
        });
    } catch (error) {
        console.error('Error initializing app:', error);
    }
}

initApp().catch(console.error);