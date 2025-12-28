let currentPosition = null;
let currentOptions = [];
let refreshInterval = null;
let refreshTimerInterval = null;
let secondsSinceRefresh = 0;
const REFRESH_INTERVAL_MS = 30000;

let walkSpeedMultiplier = 1.0;
let pinnedRoutes = JSON.parse(localStorage.getItem('pinnedRoutes') || '[]');

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('themeToggle').addEventListener('click', () => {
        document.documentElement.classList.toggle('dark');
        localStorage.setItem('theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light');
    });

    if (localStorage.getItem('theme') === 'light') {
        document.documentElement.classList.remove('dark');
    }

    document.querySelectorAll('input[name="pace"]').forEach(input => {
        input.addEventListener('change', (e) => {
            walkSpeedMultiplier = e.target.value === 'run' ? 0.7 : 1.0;
            if (currentOptions.length > 0) {
                renderOptions(currentOptions);
            }
        });
    });

    updateGreeting();

    if (!navigator.geolocation) {
        showError('Geolocation is not supported by your browser');
        return;
    }

    navigator.geolocation.getCurrentPosition(async (position) => {
        currentPosition = position;
        await fetchCommuteData();
        refreshInterval = setInterval(fetchCommuteData, REFRESH_INTERVAL_MS);
        startRefreshTimer();
    }, (err) => {
        showError('Unable to retrieve your location: ' + err.message);
    });
});

function updateGreeting() {
    const hour = new Date().getHours();
    let greeting = 'Hello';
    if (hour < 12) greeting = 'Good Morning';
    else if (hour < 17) greeting = 'Good Afternoon';
    else greeting = 'Good Evening';
    document.getElementById('greeting').textContent = greeting + ', Commuter';
}

function showError(message) {
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('error').classList.remove('hidden');
    document.getElementById('errorText').textContent = message;
}

function showLoading() {
    document.getElementById('loading').classList.remove('hidden');
    document.getElementById('error').classList.add('hidden');
    document.getElementById('mainGrid').classList.add('hidden');
    document.getElementById('emptyState').classList.add('hidden');
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
        
        document.getElementById('loading').classList.add('hidden');
        document.getElementById('error').classList.add('hidden');
        
        renderOptions(currentOptions);
        updateLastUpdated();
        secondsSinceRefresh = 0;

    } catch (err) {
        console.error('Fetch error:', err);
        if (currentOptions.length === 0) {
            showError(err.message);
        }
    }
}

function startRefreshTimer() {
    if (refreshTimerInterval) clearInterval(refreshTimerInterval);
    refreshTimerInterval = setInterval(() => {
        secondsSinceRefresh++;
    }, 1000);
}

function updateLastUpdated() {
    const now = new Date();
    document.getElementById('lastUpdated').textContent = 
        'Last updated: ' + now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function togglePinRoute(routeKey, event) {
    event.stopPropagation();
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
    if (!options || options.length === 0) {
        document.getElementById('mainGrid').classList.add('hidden');
        document.getElementById('pinnedSection').classList.add('hidden');
        document.getElementById('emptyState').classList.remove('hidden');
        return;
    }

    document.getElementById('emptyState').classList.add('hidden');
    document.getElementById('mainGrid').classList.remove('hidden');
    document.getElementById('mainGrid').classList.add('grid');

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
                routeKey,
                line: displayLine,
                originalLine: opt.line,
                color: opt.route_color || 'FFC72C',
                isPinned: pinnedRoutes.includes(routeKey),
                destinations: {},
                minWalkSec: Infinity
            };
        }

        const routeGroup = allRoutes[routeKey];
        const dest = opt.headsign || 'Unknown';

        if (!routeGroup.destinations[dest]) {
            routeGroup.destinations[dest] = { stops: {} };
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

    const immediate = [];
    const nearby = [];
    const further = [];

    unpinnedRoutes.forEach(route => {
        const walkMins = Math.ceil((route.minWalkSec * walkSpeedMultiplier) / 60);
        if (walkMins <= 5) {
            immediate.push(route);
        } else if (walkMins <= 10) {
            nearby.push(route);
        } else {
            further.push(route);
        }
    });

    [immediate, nearby, further].forEach(arr => arr.sort((a, b) => a.minWalkSec - b.minWalkSec));

    renderPinnedSection(pinnedRoutesArr);
    document.getElementById('immediateCards').innerHTML = immediate.map(r => renderRouteCards(r)).join('');
    document.getElementById('nearbyCards').innerHTML = nearby.map(r => renderRouteCards(r)).join('');
    document.getElementById('furtherCards').innerHTML = further.map(r => renderRouteCards(r)).join('');

    if (options.length > 0) {
        const firstStop = options[0].stop_name;
        document.getElementById('locationText').textContent = `Near ${firstStop}`;
    }
}

function renderPinnedSection(pinnedRoutesArr) {
    const section = document.getElementById('pinnedSection');
    const container = document.getElementById('pinnedRoutes');

    if (pinnedRoutesArr.length === 0) {
        section.classList.add('hidden');
        section.classList.remove('flex');
        return;
    }

    section.classList.remove('hidden');
    section.classList.add('flex');

    container.innerHTML = pinnedRoutesArr.map(route => {
        const firstDest = Object.keys(route.destinations)[0];
        const destData = route.destinations[firstDest];
        const stops = Object.values(destData.stops);
        stops.sort((a, b) => a.walkSec - b.walkSec);
        const bestStop = stops[0];
        const adjustedWalkSec = bestStop.walkSec * walkSpeedMultiplier;
        const walkMins = Math.ceil(adjustedWalkSec / 60);

        const opts = bestStop.predictions;
        opts.sort((a, b) => new Date(a.time_to_leave) - new Date(b.time_to_leave));
        const nextOpt = opts[0];

        const now = new Date();
        const adjustedLeaveMs = new Date(nextOpt.departure_time).getTime() - (adjustedWalkSec * 1000);
        const adjustedLeaveDate = new Date(adjustedLeaveMs);
        const minsUntilLeave = Math.floor((adjustedLeaveDate - now) / 60000);

        const { statusText, statusClass, bgClass } = getStatusInfo(minsUntilLeave);
        const leaveText = getLeaveText(minsUntilLeave);
        const colorClass = getColorClass(route.originalLine);

        return `
            <div class="snap-start shrink-0 grow-0 w-80 md:w-96 lg:w-[420px] h-44 bg-white dark:bg-[#233648] p-5 rounded-2xl shadow-sm border border-slate-100 dark:border-transparent flex flex-col justify-between relative overflow-hidden group cursor-pointer" onclick="showDetails(${JSON.stringify(nextOpt).replace(/"/g, '&quot;')})">
                ${minsUntilLeave <= 5 ? '<div class="absolute top-0 right-0 w-24 h-24 bg-red-500/10 rounded-bl-full -mr-4 -mt-4"></div>' : ''}
                <div class="flex items-start justify-between relative z-10 w-full">
                    <div class="flex items-center gap-3 min-w-0 flex-1">
                        <div class="size-10 rounded-full ${colorClass} flex items-center justify-center text-white font-bold text-lg shrink-0">${route.line}</div>
                        <div class="min-w-0 flex-1">
                            <p class="text-slate-900 dark:text-white font-bold leading-none truncate">${getRouteTypeName(route.originalLine)}</p>
                            <p class="text-slate-500 dark:text-[#92adc9] text-xs mt-1 truncate">To ${firstDest}</p>
                        </div>
                    </div>
                    <span class="${statusClass} text-xs font-bold px-2 py-1 rounded-full uppercase tracking-wider whitespace-nowrap shrink-0">${statusText}</span>
                </div>
                <div class="w-full">
                    <p class="text-2xl font-black text-slate-900 dark:text-white tracking-tight">${leaveText}</p>
                    <p class="text-slate-500 dark:text-[#92adc9] text-sm flex items-center gap-1 mt-1">
                        <span class="material-symbols-outlined text-sm shrink-0">directions_walk</span>
                        <span class="truncate">${walkMins} min to ${bestStop.stopName}</span>
                    </p>
                </div>
                <button onclick="togglePinRoute('${route.routeKey}', event)" class="absolute bottom-4 right-4 text-primary hover:text-blue-400 transition-colors z-20">
                    <span class="material-symbols-outlined text-xl" style="font-variation-settings: 'FILL' 1;">push_pin</span>
                </button>
            </div>
        `;
    }).join('');
}

function renderRouteCards(route) {
    return Object.entries(route.destinations).map(([destName, destData]) => {
        const stops = Object.values(destData.stops);
        if (stops.length === 0) return '';

        stops.sort((a, b) => a.walkSec - b.walkSec);
        const bestStop = stops[0];
        const adjustedWalkSec = bestStop.walkSec * walkSpeedMultiplier;
        const walkMins = Math.ceil(adjustedWalkSec / 60);

        const opts = bestStop.predictions;
        opts.sort((a, b) => new Date(a.time_to_leave) - new Date(b.time_to_leave));

        const nextOpt = opts[0];
        const now = new Date();
        const adjustedLeaveMs = new Date(nextOpt.departure_time).getTime() - (adjustedWalkSec * 1000);
        const adjustedLeaveDate = new Date(adjustedLeaveMs);
        const minsUntilLeave = Math.floor((adjustedLeaveDate - now) / 60000);

        const { statusText, statusClass } = getStatusInfo(minsUntilLeave);
        const leaveText = getLeaveText(minsUntilLeave);
        const colorClass = getColorClass(route.originalLine);
        const isPinned = pinnedRoutes.includes(route.routeKey);

        const timePills = opts.slice(0, 3).map((opt, idx) => {
            const optLeaveMs = new Date(opt.departure_time).getTime() - (adjustedWalkSec * 1000);
            const optLeaveDate = new Date(optLeaveMs);
            const optMins = Math.floor((optLeaveDate - now) / 60000);

            const isSelected = idx === 0;
            const pillText = optMins <= 0 ? 'Now' : optMins + ' min';

            return `<button onclick="showDetails(${JSON.stringify(opt).replace(/"/g, '&quot;')})" class="${isSelected ? 'bg-primary text-white shadow-lg shadow-primary/20 hover:bg-blue-600' : 'bg-slate-100 dark:bg-[#111a22] text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-[#233648]'} flex-1 py-2 px-3 rounded-full text-sm font-medium transition-colors">${pillText}</button>`;
        }).join('');

        return `
            <div class="bg-white dark:bg-[#1e2936] p-4 rounded-3xl shadow-sm border border-slate-100 dark:border-transparent hover:shadow-md transition-shadow">
                <div class="flex justify-between items-start mb-4">
                    <div class="flex gap-3">
                        <div class="w-12 h-12 rounded-full ${colorClass} flex items-center justify-center font-bold text-xl shadow-sm">${route.line}</div>
                        <div class="flex flex-col justify-center">
                            <span class="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">${getRouteTypeName(route.originalLine)}</span>
                            <span class="font-bold text-slate-900 dark:text-white">To ${destName}</span>
                        </div>
                    </div>
                    <div class="flex items-center gap-2">
                        ${statusText ? `<span class="${statusClass} text-xs font-bold px-2 py-1 rounded-full">${statusText}</span>` : ''}
                        <button onclick="togglePinRoute('${route.routeKey}', event)" class="${isPinned ? 'text-primary' : 'text-slate-300 dark:text-slate-600 hover:text-primary'}">
                            <span class="material-symbols-outlined text-xl">${isPinned ? 'push_pin' : 'push_pin'}</span>
                        </button>
                    </div>
                </div>
                <div class="mb-4">
                    <div class="flex items-baseline gap-2">
                        <span class="text-2xl font-black text-slate-900 dark:text-white tracking-tighter">${leaveText}</span>
                    </div>
                    <div class="flex items-center gap-1 text-slate-500 dark:text-[#92adc9] text-sm mt-1">
                        <span class="material-symbols-outlined text-sm">directions_walk</span>
                        <span>${walkMins} min walk from ${bestStop.stopName}</span>
                    </div>
                </div>
                <div class="flex gap-2">
                    ${timePills}
                </div>
            </div>
        `;
    }).join('');
}

function getStatusInfo(minsUntilLeave) {
    if (minsUntilLeave <= 2) {
        return {
            statusText: 'Hurry',
            statusClass: 'bg-red-500/20 text-red-600 dark:text-red-400',
            bgClass: 'bg-red-500/10'
        };
    } else if (minsUntilLeave <= 5) {
        return {
            statusText: 'Might Miss',
            statusClass: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
            bgClass: ''
        };
    } else if (minsUntilLeave <= 10) {
        return {
            statusText: 'On Time',
            statusClass: 'bg-primary/20 text-primary dark:text-blue-300',
            bgClass: ''
        };
    }
    return {
        statusText: 'Comfortable',
        statusClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
        bgClass: ''
    };
}

function getLeaveText(minsUntilLeave) {
    if (minsUntilLeave <= 0) return 'Leave NOW';
    if (minsUntilLeave === 1) return 'Leave in 1m';
    return `Leave in ${minsUntilLeave}m`;
}

function getColorClass(line) {
    if (line.startsWith('Red') || line === 'RL') return 'bg-mbta-red text-white';
    if (line.startsWith('Green') || ['A', 'B', 'C', 'D', 'E'].includes(line)) return 'bg-mbta-green text-white';
    if (line.startsWith('Orange') || line === 'OL') return 'bg-mbta-orange text-white';
    if (line.startsWith('Blue') || line === 'BL') return 'bg-mbta-blue text-white';
    if (line.startsWith('Silver') || line === 'SL') return 'bg-mbta-silver text-white';
    if (line.startsWith('CR-') || line === 'CR') return 'bg-mbta-purple text-white';
    return 'bg-mbta-yellow text-black';
}

function getRouteTypeName(line) {
    if (line === 'RL') return 'Red Line';
    if (line === 'OL') return 'Orange Line';
    if (line === 'BL') return 'Blue Line';
    if (line === 'GL') return 'Green Line';
    if (['A', 'B', 'C', 'D', 'E'].includes(line)) return 'Green Line ' + line;
    if (line === 'SL' || line.startsWith('SL')) return 'Silver Line';
    if (line.startsWith('CR-')) return line.replace('CR-', '') + ' Line';
    return 'Bus ' + line;
}

function showDetails(opt) {
    const modal = document.getElementById('detailModal');
    const body = document.getElementById('modalBody');

    const now = new Date();
    const departTime = new Date(opt.departure_time);
    const adjustedWalkSec = opt.walk_time_sec * walkSpeedMultiplier;
    const adjustedLeaveMs = departTime.getTime() - (adjustedWalkSec * 1000);
    const adjustedLeaveDate = new Date(adjustedLeaveMs);
    const minsUntilLeave = Math.floor((adjustedLeaveDate - now) / 60000);
    
    const departTimeStr = departTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const walkMins = Math.ceil(adjustedWalkSec / 60);
    const routeColor = opt.route_color || 'FFC72C';
    const textColor = isLight(routeColor) ? '#111a22' : '#ffffff';
    const displayLine = opt.line.replace('Green-', '').split('-')[0];
    const isPinned = pinnedRoutes.includes(opt.line);
    
    const routeIcon = getRouteIcon(opt.line);
    const countdownDisplay = minsUntilLeave <= 0 ? 'NOW' : minsUntilLeave;
    const countdownUnit = minsUntilLeave <= 0 ? '' : '<span class="text-2xl font-bold text-slate-500 dark:text-slate-400 align-top ml-1">min</span>';

    body.innerHTML = `
        <!-- Headline Section: Countdown -->
        <div class="flex flex-col items-center py-4">
            <h1 class="text-slate-900 dark:text-white text-[56px] font-black tracking-tight text-center leading-none">
                ${countdownDisplay} ${countdownUnit}
            </h1>
            <!-- Live Status Pill -->
            <div class="flex items-center gap-2 mt-4 text-primary font-bold bg-primary/10 pl-3 pr-4 py-1.5 rounded-full border border-primary/20">
                <span class="relative flex h-3 w-3">
                    <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                    <span class="relative inline-flex rounded-full h-3 w-3 bg-primary"></span>
                </span>
                <span class="text-sm">${opt.status || 'Real-time'} • ${departTimeStr}</span>
            </div>
        </div>

        <!-- Route Details Card -->
        <div class="bg-white dark:bg-[#1b2530] rounded-lg p-5 mt-4 border border-slate-200 dark:border-slate-700/50 shadow-sm relative overflow-hidden">
            <!-- Decorative accent line on left -->
            <div class="absolute left-0 top-0 bottom-0 w-1" style="background-color: #${routeColor};"></div>
            
            <div class="flex items-start gap-4">
                <!-- Route ID Badge -->
                <div class="h-14 w-14 shrink-0 rounded-xl flex items-center justify-center font-black text-2xl shadow-sm" style="background-color: #${routeColor}; color: ${textColor};">
                    ${displayLine}
                </div>
                <div class="flex flex-col flex-1 min-w-0">
                    <!-- Destination -->
                    <h2 class="text-slate-900 dark:text-white text-xl font-bold leading-tight mb-1 truncate">${opt.headsign || 'Unknown'}</h2>
                    <!-- Route Type -->
                    <div class="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 text-sm mb-4">
                        <span class="material-symbols-outlined text-[18px]">${routeIcon}</span>
                        <span>${getRouteTypeName(opt.line)}</span>
                    </div>
                    <!-- Stop Detail -->
                    <div class="flex items-start gap-3 pt-3 border-t border-slate-100 dark:border-slate-700/50">
                        <div class="mt-0.5 p-1 bg-slate-100 dark:bg-slate-700 rounded text-slate-500 dark:text-slate-300">
                            <span class="material-symbols-outlined text-[16px] block">place</span>
                        </div>
                        <div>
                            <p class="text-slate-900 dark:text-white text-sm font-bold">${opt.stop_name}</p>
                            <div class="flex items-center gap-2 mt-1">
                                <div class="flex items-center gap-1 text-slate-500 dark:text-slate-400 text-xs">
                                    <span class="material-symbols-outlined text-[14px]">directions_walk</span>
                                    ${walkMins} min walk${walkSpeedMultiplier < 1 ? ' (running)' : ''}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Action Buttons -->
        <div class="flex flex-col gap-3 mt-6">
            <button onclick="openMapsNavigation('${opt.stop_name}')" class="w-full bg-primary hover:bg-blue-600 active:bg-blue-700 text-white font-bold text-lg py-4 rounded-full flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-lg shadow-primary/20">
                <span class="material-symbols-outlined">navigation</span>
                Navigate to Stop
            </button>
            <button onclick="togglePinRoute('${opt.line}', event); closeModal();" class="w-full bg-transparent hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white font-semibold py-3 rounded-full flex items-center justify-center gap-2 transition-colors border border-transparent hover:border-slate-200 dark:hover:border-slate-700">
                <span class="material-symbols-outlined">${isPinned ? 'push_pin' : 'favorite_border'}</span>
                ${isPinned ? 'Remove from Pinned' : 'Add to Favorites'}
            </button>
        </div>
    `;

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function getRouteIcon(line) {
    if (line.startsWith('CR-')) return 'train';
    if (line === 'RL' || line === 'OL' || line === 'BL' || line === 'GL') return 'subway';
    if (['A', 'B', 'C', 'D', 'E'].includes(line)) return 'subway';
    if (line === 'SL' || line.startsWith('SL')) return 'directions_bus';
    return 'directions_bus';
}

function openMapsNavigation(stopName) {
    const query = encodeURIComponent(stopName + ', Boston, MA');
    window.open(`https://www.google.com/maps/search/?api=1&query=${query}`, '_blank');
}

function isLight(hex) {
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    return ((r * 299) + (g * 587) + (b * 114)) / 1000 >= 128;
}

function closeModal() {
    const modal = document.getElementById('detailModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

document.getElementById('detailModal').addEventListener('click', (e) => {
    if (e.target.id === 'detailModal') closeModal();
});

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

document.getElementById('aboutModal').addEventListener('click', (e) => {
    if (e.target.id === 'aboutModal') closeAbout();
});
