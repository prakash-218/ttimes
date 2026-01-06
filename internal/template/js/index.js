let currentPosition = null;
let currentOptions = [];
let refreshInterval = null;
let refreshTimerInterval = null;
let modalTimerInterval = null;
let cardsTimerInterval = null;
let currentModalOpt = null;
let savedCardsData = [];

const REFRESH_INTERVAL_MS = 30000;

let walkSpeedMultiplier = 1.0;
let pinnedRoutes = JSON.parse(localStorage.getItem('pinnedRoutes') || '[]');

document.addEventListener('DOMContentLoaded', () => {
    
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            document.documentElement.classList.toggle('dark');
            localStorage.setItem('theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light');
        });
    }

    if (localStorage.getItem('theme') === 'light') {
        document.documentElement.classList.remove('dark');
    }

    
    document.querySelectorAll('input[name="pace"]').forEach(input => {
        input.addEventListener('change', (e) => {
            walkSpeedMultiplier = e.target.value === 'run' ? 0.7 : 1.0;
            if (currentOptions.length > 0) {
                renderOptions(currentOptions);
                
                if (!document.getElementById('detailModal').classList.contains('hidden') && currentModalOpt) {
                    showDetails(currentModalOpt);
                }
            }
        });
    });

    
    if (!navigator.geolocation) {
        showError('Geolocation is not supported by your browser');
        return;
    }

    const geoOptions = {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 60000
    };

    navigator.geolocation.getCurrentPosition(
        async (position) => {
            currentPosition = position;
            await fetchCommuteData();
            refreshInterval = setInterval(fetchCommuteData, REFRESH_INTERVAL_MS);
        }, 
        (err) => {
            let errorMsg = 'Unable to retrieve your location.';
            switch(err.code) {
                case err.PERMISSION_DENIED:
                    errorMsg = 'Location permission denied. Please enable location access in your browser settings.';
                    break;
                case err.POSITION_UNAVAILABLE:
                    errorMsg = 'Location information unavailable. Please try again.';
                    break;
                case err.TIMEOUT:
                    errorMsg = 'Location request timed out. Please try again.';
                    break;
            }
            showError(errorMsg);
        },
        geoOptions
    );
});

function showError(message) {
    document.getElementById('loadingView').classList.remove('hidden');
    document.getElementById('dashboardView').classList.add('hidden');
    
    
    document.getElementById('errorContainer').classList.remove('hidden');
    document.getElementById('errorContainer').classList.add('flex');
    document.getElementById('errorText').textContent = message;
}

function showLoading() {
    document.getElementById('loadingView').classList.remove('hidden');
    document.getElementById('dashboardView').classList.add('hidden');
    document.getElementById('errorContainer').classList.add('hidden');
    document.getElementById('errorContainer').classList.remove('flex');
}

function showDashboard() {
    document.getElementById('loadingView').classList.add('hidden');
    document.getElementById('dashboardView').classList.remove('hidden');
    document.getElementById('dashboardView').classList.add('flex');
}

async function fetchCommuteData() {
    if (!currentPosition) return;

    
    if (currentOptions.length === 0) {
        showLoading();
    }

    try {
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
        
        showDashboard();
        renderOptions(currentOptions);

    } catch (err) {
        console.error('Fetch error:', err);
        if (currentOptions.length === 0) {
            showError(err.message);
        }
    }
}

function renderOptions(options) {
    if (!options || options.length === 0) {
        document.getElementById('savedSection').classList.add('hidden');
        document.getElementById('immediateSection').classList.add('hidden');
        document.getElementById('nearbySection').classList.add('hidden');
        document.getElementById('furtherSection').classList.add('hidden');
        document.getElementById('emptyState').classList.remove('hidden');
        document.getElementById('emptyState').classList.add('flex');
        return;
    }

    document.getElementById('emptyState').classList.add('hidden');
    document.getElementById('emptyState').classList.remove('flex');

    
    
    
    
    
    
    const allRoutes = {};

    options.forEach(opt => {
        
        let displayLine = opt.line;
        if (displayLine.startsWith('Green-')) {
            displayLine = displayLine.replace('Green-', '');
        } else if (displayLine.includes('-')) {
            displayLine = displayLine.split('-')[0];
        }
        
        
        const groupKey = `${opt.line}|${opt.headsign}`;

        if (!allRoutes[groupKey]) {
            allRoutes[groupKey] = {
                groupKey,
                line: displayLine,
                originalLine: opt.line,
                headsign: opt.headsign,
                color: opt.route_color || 'FFC72C',
                isPinned: pinnedRoutes.includes(opt.line), 
                stops: {} 
            };
        }

        const routeGroup = allRoutes[groupKey];
        const stopKey = opt.stop_name;
        
        if (!routeGroup.stops[stopKey]) {
            routeGroup.stops[stopKey] = {
                stopName: opt.stop_name,
                walkSec: opt.walk_time_sec,
                predictions: []
            };
        }
        routeGroup.stops[stopKey].predictions.push(opt);
    });

    
    
    const cards = [];

    Object.values(allRoutes).forEach(group => {
        
        
        const stops = Object.values(group.stops);
        stops.sort((a, b) => a.walkSec - b.walkSec);
        const bestStop = stops[0];

        
        bestStop.predictions.sort((a, b) => new Date(a.time_to_leave) - new Date(b.time_to_leave));
        const nextOpt = bestStop.predictions[0];

        if (!nextOpt) return;

        cards.push({
            group,
            bestStop,
            nextOpt,
            walkSec: bestStop.walkSec
        });
    });

    
    cards.sort((a, b) => a.walkSec - b.walkSec);

    
    const savedCards = cards.filter(c => c.group.isPinned);
    
    
    
    
    
    
    const immediate = cards.filter(c => getWalkMins(c.walkSec) < 5);
    const nearby = cards.filter(c => {
        const m = getWalkMins(c.walkSec);
        return m >= 5 && m <= 10;
    });
    const further = cards.filter(c => getWalkMins(c.walkSec) > 10);

    
    const savedContainer = document.getElementById('savedCards');
    const savedSection = document.getElementById('savedSection');
    savedCardsData = savedCards;
    if (savedCards.length > 0) {
        savedSection.classList.remove('hidden');
        savedSection.classList.add('flex');
        savedContainer.innerHTML = savedCards.map((c, i) => renderSavedCard(c, i)).join('');
        startSavedCardsTimer();
    } else {
        savedSection.classList.add('hidden');
        savedSection.classList.remove('flex');
        stopSavedCardsTimer();
    }

    
    const immediateContainer = document.getElementById('immediateCards');
    const immediateSection = document.getElementById('immediateSection');
    if (immediate.length > 0) {
        immediateSection.classList.remove('hidden');
        immediateSection.classList.add('flex');
        immediateContainer.innerHTML = immediate.map(c => renderMainCard(c)).join('');
    } else {
        immediateSection.classList.add('hidden');
        immediateSection.classList.remove('flex');
    }

    
    const nearbyContainer = document.getElementById('nearbyCards');
    const nearbySection = document.getElementById('nearbySection');
    if (nearby.length > 0) {
        nearbySection.classList.remove('hidden');
        nearbySection.classList.add('flex');
        nearbyContainer.innerHTML = nearby.map(c => renderMainCard(c)).join('');
    } else {
        nearbySection.classList.add('hidden');
        nearbySection.classList.remove('flex');
    }

    
    const furtherContainer = document.getElementById('furtherCards');
    const furtherSection = document.getElementById('furtherSection');
    if (further.length > 0) {
        furtherSection.classList.remove('hidden');
        furtherSection.classList.add('flex');
        furtherContainer.innerHTML = further.map(c => renderMainCard(c)).join('');
    } else {
        furtherSection.classList.add('hidden');
        furtherSection.classList.remove('flex');
    }

    if (currentOptions.length > 0) {
        document.getElementById('locationHeader').textContent = currentOptions[0].stop_name;
    }
}

function getWalkMins(sec) {
    return Math.ceil((sec * walkSpeedMultiplier) / 60);
}

function renderSavedCard(card, index) {
    const { group, nextOpt, bestStop } = card;
    
    const now = new Date();
    const walkMs = bestStop.walkSec * walkSpeedMultiplier * 1000;
    const leaveTime = new Date(new Date(nextOpt.departure_time).getTime() - walkMs);
    const minsUntilLeave = Math.max(0, Math.floor((leaveTime - now) / 60000));
    
    const colorBg = `bg-[#${group.color}]`;
    const isYellow = group.color === 'FFC72C';
    const textColor = isYellow ? 'text-black' : 'text-white';

    const optJson = JSON.stringify(nextOpt).replace(/"/g, '&quot;');

    return `
    <div onclick="showDetails(${optJson})" class="flex items-center gap-2 px-3 py-2 rounded-full bg-white dark:bg-card-dark border border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-md hover:border-primary/50 transition-all cursor-pointer group">
        <div class="flex items-center justify-center h-6 w-6 rounded-full ${colorBg} ${textColor} font-bold text-[10px] shrink-0">
            ${group.line}
        </div>
        <span class="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate max-w-[100px]">${group.headsign}</span>
        <span id="saved-time-${index}" class="text-xs font-bold text-primary tabular-nums">${minsUntilLeave}m</span>
        <button onclick="togglePin('${group.originalLine}', event)" class="opacity-60 group-hover:opacity-100 transition-opacity">
            <span class="material-symbols-outlined text-primary text-[16px]" style="font-variation-settings: 'FILL' 1;">favorite</span>
        </button>
    </div>
    `;
}


function renderMainCard(card) {
    const { group, nextOpt, bestStop } = card;
    const walkMins = getWalkMins(bestStop.walkSec);
    
    
    const now = new Date();
    const walkMs = bestStop.walkSec * walkSpeedMultiplier * 1000;
    const leaveTime = new Date(new Date(nextOpt.departure_time).getTime() - walkMs);
    const minsUntilLeave = Math.floor((leaveTime - now) / 60000);

    const status = getStatus(minsUntilLeave);
    
    
    
    let timeDisplay = "";
    if (minsUntilLeave <= 0) {
        timeDisplay = "NOW";
    } else if (minsUntilLeave > 60) {
        timeDisplay = `${Math.floor(minsUntilLeave/60)}h ${minsUntilLeave%60}m`;
    } else {
        
        
        
        
        
        timeDisplay = `${minsUntilLeave.toString().padStart(2, '0')} min`;
    }

    const colorBg = `bg-[#${group.color}]`;
    const isYellow = group.color === 'FFC72C';
    const textColor = isYellow ? 'text-black' : 'text-white';
    
    
    
    const optJson = JSON.stringify(nextOpt).replace(/"/g, '&quot;');

    return `
    <div onclick="showDetails(${optJson})" class="group flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 rounded-xl bg-white dark:bg-card-dark border border-gray-100 dark:border-gray-800 shadow-sm hover:border-primary/50 transition-all cursor-pointer">
        <div class="flex items-center gap-4 w-full sm:w-auto">
            <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${colorBg} ${textColor} font-bold shadow-sm">
                ${group.line}
            </div>
            <div class="flex flex-col min-w-0">
                <span class="text-lg font-bold text-slate-900 dark:text-white truncate pr-2">${group.headsign}</span>
                <div class="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                    <span class="material-symbols-outlined text-[16px]">directions_walk</span>
                    <span>${walkMins} min</span>
                    <span class="text-xs text-slate-300 dark:text-slate-600">•</span>
                    <span class="text-xs truncate max-w-[150px]">${bestStop.stopName}</span>
                </div>
            </div>
        </div>
        <div class="flex flex-row sm:flex-col items-center sm:items-end justify-between w-full sm:w-auto mt-3 sm:mt-0 pl-[64px] sm:pl-0">
            <div class="text-3xl font-bold font-mono text-primary tracking-tight">${timeDisplay}</div>
            <div class="flex items-center gap-1 text-xs font-bold ${status.classes} px-2 py-0.5 rounded uppercase">
                ${status.icon ? `<span class="material-symbols-outlined text-[14px]">${status.icon}</span>` : ''} 
                ${status.text}
            </div>
        </div>
    </div>
    `;
}

function getStatus(mins) {
    if (mins <= 2) {
        return { text: 'HURRY', classes: 'text-red-500 bg-red-50 dark:bg-red-900/20', icon: 'bolt' };
    } else if (mins <= 5) {
        return { text: 'MIGHT MISS', classes: 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20' };
    } else if (mins <= 10) {
        return { text: 'ON TIME', classes: 'text-slate-500 dark:text-slate-400' };
    } else {
        return { text: 'COMFORTABLE', classes: 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20' };
    }
}


function showDetails(opt) {
    currentModalOpt = opt;
    const modal = document.getElementById('detailModal');
    
    
    let displayLine = opt.line;
    if (displayLine.startsWith('Green-')) displayLine = displayLine.replace('Green-', '');
    else if (displayLine.includes('-')) displayLine = displayLine.split('-')[0];

    
    const colorHex = opt.route_color || 'FFC72C';
    const isYellow = colorHex === 'FFC72C';
    const textColorClass = isYellow ? 'text-black' : 'text-white';

    
    const iconDiv = document.getElementById('modalLineIcon');
    iconDiv.style.backgroundColor = `#${colorHex}`;
    iconDiv.className = `flex items-center justify-center size-8 rounded-full shadow-sm ${textColorClass}`;
    
    document.getElementById('modalLineName').textContent = getRouteFullName(opt.line);
    document.getElementById('modalStopName').textContent = opt.stop_name;
    document.getElementById('modalHeadsign').textContent = `To ${opt.headsign}`;

    
    const walkMins = Math.ceil((opt.walk_time_sec * walkSpeedMultiplier) / 60);
    document.getElementById('modalWalkTime').textContent = `${walkMins} min walk`;
    
    const depTime = new Date(opt.departure_time);
    document.getElementById('modalDepTime').textContent = `Departs ${depTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;

    
    const navBtn = document.getElementById('modalNavBtn');
    navBtn.onclick = () => {
        const query = encodeURIComponent(opt.stop_name + ', Boston, MA');
        window.open(`https://www.google.com/maps/search/?api=1&query=${query}`, '_blank');
    };

    
    const pinBtn = document.getElementById('modalTogglePinBtn');
    const isPinned = pinnedRoutes.includes(opt.line);
    pinBtn.innerHTML = `
        <span class="material-symbols-outlined text-[18px]">${isPinned ? 'favorite' : 'favorite_border'}</span>
        <span>${isPinned ? 'Remove from Favorites' : 'Save to Favorites'}</span>
    `;
    pinBtn.onclick = (e) => {
        togglePin(opt.line, e);
        showDetails(opt); 
    };

    
    updateModalTimer();
    if (modalTimerInterval) clearInterval(modalTimerInterval);
    modalTimerInterval = setInterval(updateModalTimer, 1000);

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function updateModalTimer() {
    if (!currentModalOpt) return;
    
    const now = new Date();
    const walkMs = currentModalOpt.walk_time_sec * walkSpeedMultiplier * 1000;
    const leaveTime = new Date(new Date(currentModalOpt.departure_time).getTime() - walkMs);
    const diffMs = leaveTime - now;
    
    let mins = 0;
    let secs = 0;
    
    if (diffMs > 0) {
        mins = Math.floor(diffMs / 60000);
        secs = Math.floor((diffMs % 60000) / 1000);
    }

    document.getElementById('modalMins').textContent = mins.toString().padStart(2, '0');
    document.getElementById('modalSecs').textContent = secs.toString().padStart(2, '0');

    
    const status = getStatus(mins);
    document.getElementById('modalStatusText').textContent = status.text;
    document.getElementById('modalStatusText').className = `text-xs font-bold uppercase tracking-wider ${status.classes.split(' ')[0]}`; 
    
    
    let colorName = 'green';
    if (mins <= 2) colorName = 'red';
    else if (mins <= 5) colorName = 'orange';
    
    
    const dot = document.getElementById('modalStatusDot');
    dot.className = `relative inline-flex rounded-full h-3 w-3 bg-${colorName}-500`;
    dot.previousElementSibling.className = `animate-ping absolute inline-flex h-full w-full rounded-full bg-${colorName}-400 opacity-75`;
    
    
    document.getElementById('modalStatusText').className = `text-xs font-bold uppercase tracking-wider text-${colorName}-600 dark:text-${colorName}-400`;
}

function closeModal() {
    document.getElementById('detailModal').classList.add('hidden');
    document.getElementById('detailModal').classList.remove('flex');
    if (modalTimerInterval) clearInterval(modalTimerInterval);
    currentModalOpt = null;
}

function startSavedCardsTimer() {
    if (cardsTimerInterval) clearInterval(cardsTimerInterval);
    cardsTimerInterval = setInterval(updateSavedCardsTimes, 1000);
}

function stopSavedCardsTimer() {
    if (cardsTimerInterval) {
        clearInterval(cardsTimerInterval);
        cardsTimerInterval = null;
    }
}

function updateSavedCardsTimes() {
    savedCardsData.forEach((card, index) => {
        const el = document.getElementById(`saved-time-${index}`);
        if (!el) return;
        
        const { bestStop, nextOpt } = card;
        const now = new Date();
        const walkMs = bestStop.walkSec * walkSpeedMultiplier * 1000;
        const leaveTime = new Date(new Date(nextOpt.departure_time).getTime() - walkMs);
        const minsUntilLeave = Math.max(0, Math.floor((leaveTime - now) / 60000));
        
        el.textContent = `${minsUntilLeave}m`;
    });
}

function togglePin(line, e) {
    if (e) e.stopPropagation();
    
    const idx = pinnedRoutes.indexOf(line);
    if (idx === -1) {
        pinnedRoutes.push(line);
    } else {
        pinnedRoutes.splice(idx, 1);
    }
    localStorage.setItem('pinnedRoutes', JSON.stringify(pinnedRoutes));
    
    
    renderOptions(currentOptions);
}

function getRouteFullName(line) {
    if (line === 'RL') return 'Red Line';
    if (line === 'OL') return 'Orange Line';
    if (line === 'BL') return 'Blue Line';
    if (line === 'GL') return 'Green Line';
    if (['A', 'B', 'C', 'D', 'E'].includes(line)) return 'Green Line ' + line;
    if (line === 'SL' || line.startsWith('SL')) return 'Silver Line ' + line.replace('SL', '');
    if (line.startsWith('CR-')) return line.replace('CR-', '') + ' Line';
    return 'Bus ' + line;
}

function showAbout() {
    const modal = document.getElementById('aboutModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeAbout() {
    const modal = document.getElementById('aboutModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}
