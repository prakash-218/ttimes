let currentPosition = null;
let currentOptions = [];
let refreshInterval = null;
let refreshTimerInterval = null;
let secondsSinceRefresh = 0;
const REFRESH_INTERVAL_MS = 30000;

let walkSpeedMultiplier = 1.0;
let pinnedRoutes = JSON.parse(localStorage.getItem('pinnedRoutes') || '[]');

document.addEventListener('DOMContentLoaded', () => {
    const loading = document.getElementById('loading');
    const modal = document.getElementById('detailModal');
    const closeModal = document.querySelector('.close-modal');

    closeModal.onclick = () => modal.style.display = "none";
    window.onclick = (event) => {
        if (event.target == modal) {
            modal.style.display = "none";
        }
    };

    document.getElementById('speedToggle').addEventListener('change', (e) => {
        walkSpeedMultiplier = e.target.checked ? 0.7 : 1.0;
        if (currentOptions.length > 0) {
            renderOptions(currentOptions);
        }
    });

    if (!navigator.geolocation) {
        loading.textContent = 'Geolocation is not supported by your browser';
        return;
    }

    loading.textContent = 'Acquiring location...';

    navigator.geolocation.getCurrentPosition(async (position) => {
        currentPosition = position;
        await fetchCommuteData();
        
        refreshInterval = setInterval(fetchCommuteData, REFRESH_INTERVAL_MS);
        updateRefreshTimer();

    }, (err) => {
        loading.textContent = 'Unable to retrieve your location: ' + err.message;
    });
});

async function fetchCommuteData() {
    if (!currentPosition) return;
    
    const loading = document.getElementById('loading');
    const refreshStatus = document.getElementById('refreshStatus');
    
    try {
        if (currentOptions.length === 0) {
            loading.textContent = 'Finding nearest stops...';
            loading.style.display = 'block';
        }
        
        const resp = await fetch('/api/commute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                lat: currentPosition.coords.latitude,
                lon: currentPosition.coords.longitude
            })
        });

        if (!resp.ok) {
            const errorText = await resp.text();
            throw new Error(`Server error (${resp.status}): ${errorText}`);
        }

        const data = await resp.json();
        currentOptions = data.options || [];
        renderOptions(currentOptions);
        loading.style.display = 'none';
        
        secondsSinceRefresh = 0;
        if (refreshStatus) {
            refreshStatus.textContent = 'Just updated';
        }

    } catch (err) {
        console.error('Fetch error:', err);
        if (currentOptions.length === 0) {
            loading.textContent = 'Error: ' + err.message;
        }
    }
}

function updateRefreshTimer() {
    const refreshStatus = document.getElementById('refreshStatus');
    
    if (refreshTimerInterval) {
        clearInterval(refreshTimerInterval);
    }
    
    refreshTimerInterval = setInterval(() => {
        secondsSinceRefresh++;
        if (secondsSinceRefresh >= 60) {
            refreshStatus.textContent = `Updated ${Math.floor(secondsSinceRefresh / 60)}m ago`;
        } else if (secondsSinceRefresh > 5) {
            refreshStatus.textContent = `Updated ${secondsSinceRefresh}s ago`;
        } else {
            refreshStatus.textContent = 'Just updated';
        }
    }, 1000);
}

function togglePinRoute(routeKey) {
    const idx = pinnedRoutes.indexOf(routeKey);
    if (idx === -1) {
        pinnedRoutes.push(routeKey);
    } else {
        pinnedRoutes.splice(idx, 1);
    }
    localStorage.setItem('pinnedRoutes', JSON.stringify(pinnedRoutes));
    renderOptions(currentOptions);
}

function renderOptions(options) {
    const results = document.getElementById('results');
    results.innerHTML = '';

    if (!options || options.length === 0) {
        results.innerHTML = '<p>No upcoming commutes found nearby.</p>';
        return;
    }

    const allRoutes = {};
    
    options.forEach(opt => {
        let displayLine = opt.line;
        if (displayLine.startsWith('Green-')) {
            displayLine = displayLine.replace('Green-', '');
        } else if (displayLine.includes('-')) {
            displayLine = displayLine.split('-')[0];
        }
        const routeKey = opt.line;

        if (!allRoutes[routeKey]) {
            allRoutes[routeKey] = {
                routeKey: routeKey,
                line: displayLine,
                color: opt.route_color || 'FFC72C',
                textColor: isLight(opt.route_color || 'FFC72C') ? 'black' : 'white',
                isPinned: pinnedRoutes.includes(routeKey),
                destinations: {},
                minWalkSec: Infinity
            };
        }

        const routeGroup = allRoutes[routeKey];
        const dest = opt.headsign || 'Unknown Destination';
        
        if (!routeGroup.destinations[dest]) {
            routeGroup.destinations[dest] = {
                stops: {}
            };
        }
        
        const stopKey = opt.stop_name;
        if (!routeGroup.destinations[dest].stops[stopKey]) {
            routeGroup.destinations[dest].stops[stopKey] = {
                stopName: opt.stop_name,
                walkSec: opt.walk_time_sec,
                predictions: []
            };
        }
        
        routeGroup.destinations[dest].stops[stopKey].predictions.push(opt);
        
        if (opt.walk_time_sec < routeGroup.minWalkSec) {
            routeGroup.minWalkSec = opt.walk_time_sec;
        }
    });

    const pinnedRoutesArr = [];
    const unpinnedRoutes = [];
    
    Object.values(allRoutes).forEach(route => {
        if (route.isPinned) {
            pinnedRoutesArr.push(route);
        } else {
            unpinnedRoutes.push(route);
        }
    });

    pinnedRoutesArr.sort((a, b) => a.minWalkSec - b.minWalkSec);

    const brackets = {
        'close': { label: '1-5 MIN WALK', routes: [] },
        'medium': { label: '5-10 MIN WALK', routes: [] },
        'far': { label: '10+ MIN WALK', routes: [] }
    };

    unpinnedRoutes.forEach(route => {
        const walkMins = Math.ceil((route.minWalkSec * walkSpeedMultiplier) / 60);
        if (walkMins <= 5) {
            brackets['close'].routes.push(route);
        } else if (walkMins <= 10) {
            brackets['medium'].routes.push(route);
        } else {
            brackets['far'].routes.push(route);
        }
    });

    Object.values(brackets).forEach(b => {
        b.routes.sort((a, b) => a.minWalkSec - b.minWalkSec);
    });

    if (pinnedRoutesArr.length > 0) {
        const header = document.createElement('div');
        header.className = 'bracket-header';
        header.innerHTML = '⭐ PINNED ROUTES';
        results.appendChild(header);

        pinnedRoutesArr.forEach(routeGroup => {
            results.appendChild(renderRouteCard(routeGroup, true));
        });
    }

    ['close', 'medium', 'far'].forEach(bracketKey => {
        const bracket = brackets[bracketKey];
        if (bracket.routes.length === 0) return;

        const header = document.createElement('div');
        header.className = 'bracket-header';
        header.textContent = bracket.label;
        results.appendChild(header);

        bracket.routes.forEach(routeGroup => {
            results.appendChild(renderRouteCard(routeGroup, false));
        });
    });
}

function renderRouteCard(routeGroup, isPinned) {
    const div = document.createElement('div');
    div.className = 'group';

    let routeContentHtml = '';

    Object.entries(routeGroup.destinations).forEach(([destName, destData]) => {
        const stops = Object.values(destData.stops);
        if (stops.length === 0) return;
        
        stops.sort((a, b) => a.walkSec - b.walkSec);
        const bestStop = stops[0];
        const adjustedWalkSec = bestStop.walkSec * walkSpeedMultiplier;
        const walkMins = Math.ceil(adjustedWalkSec / 60);

        const opts = bestStop.predictions;
        opts.sort((a, b) => new Date(a.time_to_leave) - new Date(b.time_to_leave));

        const timesHtml = opts.slice(0, 3).map(opt => {
            const now = new Date();
            const adjustedLeaveMs = new Date(opt.departure_time).getTime() - (adjustedWalkSec * 1000);
            const adjustedLeaveDate = new Date(adjustedLeaveMs);
            const minsUntilLeave = Math.floor((adjustedLeaveDate - now) / 60000);
            
            let content = '';
            let className = 'time-pill';

            if (minsUntilLeave <= 5 && minsUntilLeave > 0) {
                className += ' hurry';
                content = `<svg class="clock-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg> hurry`;
            } else if (minsUntilLeave <= 0) {
                className += ' hurry';
                content = `<svg class="clock-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg> might miss`;
            } else {
                content = `<svg class="clock-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg> ${minsUntilLeave} min`;
            }
            
            const safeOpt = JSON.stringify(opt).replace(/"/g, '&quot;');
            return `<button class="${className}" onclick="showDetails(${safeOpt})">${content}</button>`;
        }).join('');

        routeContentHtml += `
            <div class="destination-row">
                <div style="flex: 1; padding-right: 10px;">
                    <div class="dest-name">To ${destName}</div>
                    <div class="walking-info" style="margin-bottom: 0;">
                        <svg style="width:12px;height:12px; vertical-align:middle;" viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7"/></svg> 
                        ${walkMins} min &bull; ${bestStop.stopName}
                    </div>
                </div>
                <div class="times">${timesHtml}</div>
            </div>
        `;
    });

    const pinIcon = isPinned ? '★' : '☆';
    const pinClass = isPinned ? 'pin-btn pinned' : 'pin-btn';

    div.innerHTML = `
        <div class="line-badge" style="background-color: #${routeGroup.color}; color: ${routeGroup.textColor}">
            ${routeGroup.line}
        </div>
        <div class="group-content bg-${toColorName(routeGroup.line)}">
            <button class="${pinClass}" onclick="togglePinRoute('${routeGroup.routeKey}')" title="${isPinned ? 'Unpin' : 'Pin'} this route">
                ${pinIcon}
            </button>
            ${routeContentHtml}
        </div>
    `;
    return div;
}

function toColorName(line) {
    switch (line) {
        case 'RL': return 'red';
        case 'A':
        case 'B':
        case 'C':
        case 'D':
        case 'E':
            return 'green';
        case 'BL': return 'blue';
        case 'OL': return 'orange';
        case 'SL': return 'silver';
        default: return 'yellow';
    }
}

function showDetails(opt) {
    const modal = document.getElementById('detailModal');
    const title = document.getElementById('modalTitle');
    const body = document.getElementById('modalBody');

    const departTime = new Date(opt.departure_time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    const leaveTime = new Date(opt.time_to_leave).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    const walkMins = Math.ceil((opt.walk_time_sec * walkSpeedMultiplier) / 60);

    title.textContent = `Details for ${opt.line} to ${opt.headsign || 'Unknown'}`;
    body.innerHTML = `
        <div class="modal-detail-row">
            <div class="modal-detail-label">Stop</div>
            <div>${opt.stop_name}</div>
        </div>
        <div class="modal-detail-row">
            <div class="modal-detail-label">Departure Time</div>
            <div>${departTime} (${opt.status || 'Scheduled'})</div>
        </div>
        <div class="modal-detail-row">
            <div class="modal-detail-label">Walking Time</div>
            <div>${walkMins} minutes${walkSpeedMultiplier < 1 ? ' (running)' : ''}</div>
        </div>
        <div class="modal-detail-row">
            <div class="modal-detail-label">Time to Leave</div>
            <div style="font-size: 1.2em; font-weight: bold; color: #d32f2f;">${leaveTime}</div>
        </div>
    `;

    modal.style.display = "block";
}

function isLight(hex) {
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    return ((r * 299) + (g * 587) + (b * 114)) / 1000 >= 128;
}
