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

/**
 * Fetches all access point data for a given level from the API.
 * @param {number} levelId - The level ID to fetch access points for. If not provided, fetches all access points.
 * @returns {Promise<Array>} Array of access point objects containing coordinates and identifiers.
 */
async function fetchAccessPoints(levelId) {
    return d3.json(`${API_BASE}/access-points${levelId ? `?levelId=${levelId}` : ''}`);
}

/**
 * Fetches all device readings (signal data) from the API.
 * @param {number} levelId - Optional level ID to filter readings by specific level.
 * @returns {Promise<Array>} Array of device readings with signal strength and timestamp information.
 */
async function fetchDeviceReadings(levelId) {
    return d3.json(`${API_BASE}/device-readings${levelId ? `?levelId=${levelId}` : ''}`);
}

/**
 * Fetches room layout and boundary data for a given level.
 * @param {number} levelId - The level ID to fetch rooms for.
 * @returns {Promise<Array>} Array of room objects containing coordinates, dimensions, and names.
 */
async function fetchRooms(levelId) {
    return d3.json(`${API_BASE}/rooms${levelId ? `?levelId=${levelId}` : ''}`);
}

/**
 * Fetches all building levels from the API.
 * @returns {Promise<Array>} Array of level objects containing floor information.
 */
async function fetchLevels() {
    return d3.json(`${API_BASE}/levels`);
}

// Utility Functions

/**
 * Converts RSSI (Received Signal Strength Indicator) to estimated distance.
 * Uses the free space path loss model formula for wireless signal propagation.
 * @param {number} rssi - The RSSI value in dBm.
 * @param {number} tx - Transmit power in dBm (defaults to RSSI_TX_POWER constant).
 * @param {number} n - Path loss exponent for the environment (defaults to PATH_LOSS_EXPONENT constant).
 * @returns {number} Estimated distance in scaled units.
 */
function rssiToDistance(rssi, tx = RSSI_TX_POWER, n = PATH_LOSS_EXPONENT) {
    return Math.pow(10, (tx - rssi) / (10 * n)) * DISTANCE_SCALE;
}

/**
 * Determines which room a given coordinate position falls within.
 * @param {number} x - The x-coordinate to check.
 * @param {number} y - The y-coordinate to check.
 * @param {Array} rooms - Array of room objects containing boundary information.
 * @returns {string} The name of the room containing the position, or "Outside" if no match.
 */
function getRoomForPosition(x, y, rooms) {
    for (const room of rooms) {
        if (x >= room.x && x <= room.x + room.width && y >= room.y && y <= room.y + room.height) {
            return room.name;
        }
    }
    return "Outside";
}

/**
 * Calculates device position using trilateration from three reference points.
 * Uses the least squares method to find the intersection point of three circles.
 * @param {Object} p1 - First reference point with properties {x, y, d} where d is distance.
 * @param {Object} p2 - Second reference point with properties {x, y, d}.
 * @param {Object} p3 - Third reference point with properties {x, y, d}.
 * @returns {Object|null} Calculated position as {x, y}, or null if triangulation fails.
 */
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

/**
 * Computes the final position of a device based on signal readings from multiple access points.
 * Filters signals for validity and applies trilateration to estimate coordinates.
 * @param {Array} accessPoints - Array of access point objects with location data.
 * @param {Array} signals - Array of signal readings from the device to different access points.
 * @param {Array} rooms - Array of room objects for position validation.
 * @returns {Object|null} Computed device position as {x, y}, or null if position is invalid or outside rooms.
 */
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

/**
 * Filters device readings to only include those from a specific building level.
 * @param {Array} readings - Array of device reading objects.
 * @param {number} levelId - The level ID to filter by.
 * @returns {Array} Filtered array containing only readings from the specified level.
 */
function filterReadingsByLevel(readings, levelId) {
    return readings.filter(r => r.levelId === levelId);
}

/**
 * Extracts the most recent reading for each unique device from a collection of readings.
 * Useful for displaying current device positions without historical data.
 * @param {Array} readings - Array of device reading objects with timestamp information.
 * @returns {Array} Array of latest readings, one per device ID.
 */
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

/**
 * Renders room boundaries and labels on the D3 SVG canvas.
 * Creates rectangles for each room with associated text labels.
 * @param {D3Selection} g - The D3 SVG group element to append room visualizations to.
 * @param {Array} rooms - Array of room objects containing coordinates, dimensions, and names.
 */
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

/**
 * Renders access point locations and identifiers on the D3 SVG canvas.
 * Displays access points as circles with identification labels.
 * @param {D3Selection} g - The D3 SVG group element to append access point visualizations to.
 * @param {Array} accessPoints - Array of access point objects containing location coordinates and IDs.
 */
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

/**
 * Initializes the sidebar toggle button functionality and icon state management.
 * Sets up click listeners and ensures icons display correctly on page load.
 * The function updates icons to match the sidebar's collapsed/expanded state.
 */
function initSidebarToggle() {
    const sidebar = document.getElementById('sidebar');
    const toggle = document.getElementById('sidebarToggle');
    const openIcon = document.querySelector('.open-icon');
    const closeIcon = document.querySelector('.close-icon');

    // Set initial icon state based on sidebar's current state
    if (sidebar.classList.contains('collapsed')) {
        openIcon.style.display = 'none';
        closeIcon.style.display = 'block';
    } else {
        openIcon.style.display = 'block';
        closeIcon.style.display = 'none';
    }

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

/**
 * Initializes the level/floor selector interface in the level picker panel.
 * Creates clickable level items and manages the active level selection state.
 * @param {Array} levels - Array of level objects containing floor numbers and names.
 */
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

/**
 * Handles switching between different building levels.
 * Fetches level-specific data, updates visualizations, and refreshes the device display.
 * @param {number} levelId - The ID of the level to switch to.
 */
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
            if (item.dataset.levelId === levelId) {
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

/**
 * Updates the device list in the sidebar with visibility toggle checkboxes.
 * Sorts devices alphabetically and includes device ID information.
 * @param {Array} readings - Array of device readings to populate the sidebar.
 */
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

/**
 * Renders all device positions on the canvas based on their calculated coordinates.
 * Handles visibility filtering, tooltips on hover, and search result highlighting.
 * @param {D3Selection} g - The D3 SVG group element to render devices on.
 * @param {Array} readings - Array of device readings to plot.
 * @param {Array} accessPoints - Array of access points used for position calculation.
 * @param {number} width - Canvas width for layout calculations.
 * @param {number} height - Canvas height for layout calculations.
 * @param {Array} rooms - Array of room objects for position validation and room information.
 * @param {string} searchTerm - Optional search term to highlight matching devices.
 */
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

/**
 * Highlights devices matching a search term with distinct visual styling.
 * Modifies the appearance of matching device circles to distinguish them from other devices.
 * @param {string} searchTerm - The search term to match against device names and IDs.
 * @param {D3Selection} g - The D3 SVG group element containing device visualizations.
 * @param {Array} readings - Array of device readings for matching logic.
 * @param {Array} accessPoints - Array of access points for position calculations.
 * @param {Array} rooms - Array of room objects for position validation.
 */
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

/**
 * Generates simulated device signal readings for testing purposes.
 * Creates realistic RSSI values from a random device to multiple access points.
 * @param {Array} accessPoints - Array of access point objects to generate signals from.
 * @param {number} levelId - The level ID to associate with the simulated reading.
 * @returns {Object} Simulated device reading object with name, ID, signals, and timestamp.
 */
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

/**
 * Refreshes the device plot visualization based on current level and search term.
 * Fetches the latest device readings and updates the visualization accordingly.
 * @param {string} searchTerm - Optional search term for highlighting specific devices.
 */
async function refreshDeviceDisplay(searchTerm = '') {
    try {
        const { innerWidth: width, innerHeight: height } = window;
        const currentReadsRaw = await fetchDeviceReadings(window.currentLevelId);
        const currentReads = filterReadingsByLevel(currentReadsRaw, window.currentLevelId);
        updateDevicePlot(window.zoomGroup, currentReads, window.accessPoints, width - 200, height, window.rooms, searchTerm);
    } catch (error) {
        console.error('Error refreshing device display:', error);
    }
}

/**
 * Initializes the entire application on page load.
 * Sets up the visualization canvas, loads data from the API, initializes UI components,
 * and attaches event listeners for user interactions including level switching, device search, and data simulation.
 */
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

        const filteredReads = filterReadingsByLevel(reads, currentLevelId);

        initLevelSelector(levels);

        const canvas = d3.select('#canvas')
            .attr('width', width - 200)
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
                    await refreshDeviceDisplay();
                    return;
                }

                const allReads = await fetchDeviceReadings();
                const allDevices = getLatestReadings(allReads);
                const matchingDevice = allDevices.find(device =>
                    device.name.toLowerCase().includes(searchTerm) ||
                    device.id.toLowerCase().includes(searchTerm)
                );

                if (matchingDevice) {
                    await switchLevel(matchingDevice.levelId);
                    await refreshDeviceDisplay(searchTerm);

                    if (searchResultEl) {
                        const pos = computeDevicePosition(window.accessPoints, matchingDevice.signals || [], window.rooms) || DEFAULT_POSITION;
                        const room = getRoomForPosition(pos.x, pos.y, window.rooms);
                        const levelName = (window.levels || []).find(l => l.id === matchingDevice.levelId)?.name || matchingDevice.levelId;
                        searchResultEl.innerHTML = `<strong>${matchingDevice.name}</strong> &mdash; Level: ${levelName}, Room: ${room}`;
                        searchResultEl.classList.add('show');
                    }
                } else {
                    if (searchResultEl) {
                        searchResultEl.classList.remove('show');
                        searchResultEl.innerHTML = '';
                    }
                    await refreshDeviceDisplay(searchTerm);
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
