#!/usr/bin/env python3
"""
Walkscape Graph Optimizer
Finds optimal routes to visit multiple locations using Dijkstra's algorithm.
"""

import math
import heapq
from itertools import permutations
from typing import List, Tuple, Optional, Union, Dict

# Import constants and utilities from shared modules
from util.walkscape_constants import *
from util.gearset_utils import gearset_to_stats, Gearset
from util.my_config_helpers import (
    RUN_SHORTCUT, EXPLORE_BOG_BOTTOM, EXPLORE_UNDERWATER_CAVE
)

# Use strings or Location.NAME.name for the locations. Either of these formats work
# Start your locations with B: for bank, T: for trinketry, K: for cooking, C: for carpentry, S: for smithing, R: for crafting
# Add 'A' after prefix for advanced: TA: for advanced trinketry, KA: for advanced cooking, etc.
# Or use helper functions: b(), t(), cook(), carp(), smith(), craft() - all take optional tier parameter
# Or use advanced shortcuts: ta(), cooka(), carpa(), smitha(), crafta()
# Services can be chained: b(t(Location.X)) means visit bank, then trinketry, then location X
test_route = [Location.EVERHAVEN, Location.BILGEMONT_PORT]
# test_route = ['Blackspell Port', 'B:Blackspell Port', 'B:Everhaven', 'B:Halfling Campgrounds', 'B:Granfiddich']
ending = Location.GRANFIDDICH_SHORES
ending = None # Comment this out if you want to use the ending above

# Player Stats - loaded from my_config.py
import my_config
AGILITY_LEVEL = my_config.get_agility_level()
LEVEL_WE = (AGILITY_LEVEL - 1) * 0.005

# Build Gear Sets from my_config
def _build_gear_sets():
    """Load gearsets from my_config (keep as export strings for location-aware stat calculation)."""
    gear_sets = {}
    for name, export_str in my_config.GEARSETS.items():
        if export_str and export_str != "H4sI...":  # Skip placeholder values
            gear_sets[name] = export_str
    return gear_sets

GEAR_SETS = _build_gear_sets()

def get_gearset_stats(gearset_name: str, location: str) -> dict:
    """Get stats for a gearset at a specific location (for location-aware bonuses)."""
    if gearset_name not in GEAR_SETS:
        return {'we': 0, 'da': 0, 'flat': 0, 'pct': 0}
    
    export_str = GEAR_SETS[gearset_name]
    gearset = Gearset(export_str)
    
    # Get location region for stat calculation
    location_region = location
    
    # Manually sum stats with location parameter
    total = {}
    
    for slot, item in gearset.get_all_items():
        if item:
            stats = item.attr(Skill.TRAVEL, location=location_region)
            for stat_name, stat_value in stats.items():
                total[stat_name] = total.get(stat_name, 0.0) + stat_value
    
    # Round all stats
    for stat_name in total:
        total[stat_name] = round(total[stat_name], 4)
    
    return total

def gearset_meets_requirements(gearset_name: str, requirements: str) -> bool:
    """Check if a gearset meets route requirements (diving gear, light sources, etc)."""
    if not requirements or gearset_name not in GEAR_SETS:
        return True
    
    export_str = GEAR_SETS[gearset_name]
    gearset = Gearset(export_str)
    items = gearset.get_all_items()  # Returns list of (slot, item) tuples
    
    # Check diving gear requirement (need 3 diving gear items)
    if 'diving_gear' in requirements or 'expert_diving_gear' in requirements or 'advanced_diving_gear' in requirements:
        diving_count = 0
        for slot, item in items:  # Unpack tuple
            if item and hasattr(item, 'keywords'):
                if any('diving gear' in kw.lower() for kw in item.keywords):
                    diving_count += 1
        if diving_count < 3:
            return False
    
    # Check light source requirements
    if '2_light_sources' in requirements or '3_light_sources' in requirements:
        light_count = 0
        seen_lights = set()
        for slot, item in items:  # Unpack tuple
            if item and hasattr(item, 'keywords'):
                if any('light source' in kw.lower() for kw in item.keywords):
                    # Count unique light sources
                    if item.name not in seen_lights:
                        light_count += 1
                        seen_lights.add(item.name)
        
        required_lights = 3 if '3_light_sources' in requirements else 2
        if light_count < required_lights:
            return False
    
    # Check skis requirement
    if 'skis' in requirements:
        has_skis = False
        for slot, item in items:  # Unpack tuple
            if item and hasattr(item, 'keywords'):
                if any('skis' in kw.lower() for kw in item.keywords):
                    has_skis = True
                    break
        if not has_skis:
            return False
    
    return True

# Load shortcuts from my_config
SHORTCUTS = {
    (a.value if isinstance(a, Location) else a,
     b.value if isinstance(b, Location) else b,
     shortcut_name,
     unlocked): steps
    for (a, b, shortcut_name, unlocked), steps in my_config.SHORTCUTS.items()
}

# Load location services from my_config
LOCATION_SERVICES = my_config.LOCATION_SERVICES

# Build service location lists
def get_service_locations(category: ServiceCategory, min_tier: ServiceTier = ServiceTier.BASIC) -> List[str]:
    """Get all unlocked locations with this service at minimum tier."""
    locations = []
    for loc, services in LOCATION_SERVICES.items():
        if category in services:
            tier, unlocked = services[category]
            if tier.value >= min_tier.value and unlocked:
                # Location enum values are LocationInfo objects with .name attribute
                loc_name = loc.name if hasattr(loc, 'name') else str(loc)
                locations.append(loc_name)
    return locations

ALL_BANKS = get_service_locations(ServiceCategory.BANK)
ALL_TRINKETRY = get_service_locations(ServiceCategory.TRINKETRY)



# Ring of Homesickness - can teleport from anywhere to Kallaheim
RING_TELEPORT_TARGET = Location.KALLAHEIM

# Location regions
JARVONIA_LOCATIONS = {
    Location.AZURAZERA.name, Location.BARBANTOK.name, Location.BEACH_OF_WOES.name,
    Location.BLACK_EYE_PEAK.name, Location.CASBRANT_FIELDS.name, Location.CENTAHAM.name,
    Location.COLDINGTON.name, Location.DISENCHANTED_FOREST.name, Location.FORT_OF_PERMAFROST.name,
    Location.FROSTBITE_MOUNTAIN.name, Location.FRUSENHOLM.name, Location.HORN_OF_RESPITE.name,
    Location.KALLAHEIM.name, Location.NOMAD_WOODS.name, Location.NOISELESS_PASS.name,
    Location.NORSACK_PLAINS.name, Location.NURTURING_NOOK_SPRINGS.name, Location.PIT_OF_PITTANCE.name,
    Location.PORT_SKILDAR.name, Location.SANGUINE_HILLS.name, Location.WINTER_WAVES_GLACIER.name,
    Location.WINTERS_END.name
}

SYRENTHIA_LOCATIONS = {
    Location.CASBRANTS_GRAVE.name, Location.DARKTIDE_TRENCH.name, Location.ELARAS_LAGOON.name,
    Location.KELP_FOREST.name, Location.UNDERWATER_CAVE.name, Location.VASTALUME.name,
    Location.GRANFIDDICH_SHORES.name
}

SWAMP_LOCATIONS = {
    Location.WITCHED_WOODS.name, Location.HALFLING_CAMPGROUNDS.name, Location.BOG_TOP.name,
    Location.BOG_BOTTOM.name, Location.HALFMAW_HIDEOUT.name
}

def to_str(loc: Union[Location, str, None]) -> Optional[str]:
    """Convert Location enum or string to string."""
    if loc is None:
        return None
    # Location enum values are LocationInfo objects with .name attribute
    if hasattr(loc, 'name'):
        return loc.name
    return str(loc)

def to_str_list(locs: List[Union[Location, str]]) -> List[str]:
    """Convert list of Location enums or strings to strings."""
    result = []
    all_prefixes = [p.value for p in ServicePrefix]
    for loc in locs:
        if isinstance(loc, str):
            # Handle service prefixes
            for prefix in all_prefixes:
                if loc.startswith(prefix):
                    result.append(prefix + to_str(loc[len(prefix):]))
                    break
            else:
                result.append(to_str(loc))
        else:
            result.append(to_str(loc))
    return result

def calc_steps(base: int, gear: str, location: str = None) -> int:
    """Calculate expected steps with DA, using location-aware stats if location provided."""
    if location:
        g = get_gearset_stats(gear, location)
    else:
        # Fallback for non-location-aware calculation (shortcuts, etc)
        if gear in GEAR_SETS:
            g = get_gearset_stats(gear, '')
        else:
            # For shortcuts like 'Ring', return base steps
            return base
    
    eff = 1.00 + LEVEL_WE + g.get('work_efficiency', 0.0)
    # steps_percent is stored as negative, so we add it (1 + (-0.01) = 0.99)
    adj = (base / eff) * (1 + g.get('steps_percent', 0.0))
    rounded_total = math.ceil(adj)
    steps_per_node = rounded_total / 10 + g.get('steps_add', 0)
    steps_per_node = max(10, math.ceil(steps_per_node))
    expected_paid_nodes = 10 / (1 + g.get('double_action', 0.0))
    return math.ceil(expected_paid_nodes * steps_per_node)

def find_breakpoint(normal: str, short: str) -> int:
    """Binary search for gear breakpoint.
    Uses a representative location for the gearset type to calculate stats."""
    # Determine representative location based on gearset name
    location = None
    if 'Jarvonia' in normal:
        location = Location.KALLAHEIM  # Representative Jarvonia location
    elif 'Diving' in normal:
        location = Location.CASBRANTS_GRAVE  # Representative underwater location
    elif 'Swamp' in normal:
        location = Location.WITCHED_WOODS  # Representative swamp location
    else:
        location = Location.TRELLIN  # Representative GDTE location
    
    lo, hi = 100, 3000
    while hi - lo > 1:
        mid = (lo + hi) // 2
        normal_steps = calc_steps(mid, normal, location=location)
        short_steps = calc_steps(mid, short, location=location)
        
        if short_steps < normal_steps:
            lo = mid
        else:
            hi = mid
    return hi

# Calculate breakpoints dynamically for any gearset with a _short variant
def _calculate_breakpoints():
    """Calculate breakpoints for all gearsets that have _short variants."""
    breakpoints = {}
    for gear_name in GEAR_SETS.keys():
        if not gear_name.endswith('_short'):
            short_name = gear_name + '_short'
            if short_name in GEAR_SETS:
                breakpoints[gear_name] = find_breakpoint(gear_name, short_name)
    return breakpoints

BREAKPOINTS = _calculate_breakpoints()

def select_gear(from_loc: str, to_loc: str, req: str, dist: int) -> str:
    """Select optimal gear for route, validating that it meets requirements."""
    # Check for custom from/to location gearsets first
    # from_loc and to_loc are already Location enums when called from _build()
    # Convert them to proper format for the custom gear name lookup
    if hasattr(from_loc, 'name') and hasattr(to_loc, 'name'):
        # They're Location enums, use them directly
        custom_gear_name = my_config.from_to_location_gear_set_name(from_loc, to_loc)
        if custom_gear_name in GEAR_SETS:
            # Validate it meets requirements
            if gearset_meets_requirements(custom_gear_name, req):
                return custom_gear_name
            # If custom gearset doesn't meet requirements, fall through to automatic selection
    
    # Convert to strings for region checks
    from_str = from_loc.name if hasattr(from_loc, 'name') else str(from_loc)
    to_str = to_loc.name if hasattr(to_loc, 'name') else str(to_loc)
    
    # By requirement - validate that selected gearset actually meets requirements
    if 'diving_gear' in req or 'expert_diving_gear' in req or 'advanced_diving_gear' in req:
        gear_name = 'Diving'
        if 'Diving' in BREAKPOINTS:
            gear_name = 'Diving' if dist >= BREAKPOINTS['Diving'] else 'Diving_short'
        # Validate
        if gear_name in GEAR_SETS and gearset_meets_requirements(gear_name, req):
            return gear_name
        # Fallback to long version if short doesn't meet requirements
        if 'Diving' in GEAR_SETS and gearset_meets_requirements('Diving', req):
            return 'Diving'
    
    if '3_light_sources' in req:
        gear_name = 'Swamp_3light'
        if 'Swamp_3light' in BREAKPOINTS:
            gear_name = 'Swamp_3light' if dist >= BREAKPOINTS['Swamp_3light'] else 'Swamp_3light_short'
        if gear_name in GEAR_SETS and gearset_meets_requirements(gear_name, req):
            return gear_name
        if 'Swamp_3light' in GEAR_SETS and gearset_meets_requirements('Swamp_3light', req):
            return 'Swamp_3light'
    
    if '2_light_sources' in req:
        if 'Swamp_2light' in GEAR_SETS and gearset_meets_requirements('Swamp_2light', req):
            return 'Swamp_2light'
    
    if 'skis' in req:
        gear_name = 'Jarvonia'
        if 'Jarvonia' in BREAKPOINTS:
            gear_name = 'Jarvonia' if dist >= BREAKPOINTS['Jarvonia'] else 'Jarvonia_short'
        if gear_name in GEAR_SETS and gearset_meets_requirements(gear_name, req):
            return gear_name
        if 'Jarvonia' in GEAR_SETS and gearset_meets_requirements('Jarvonia', req):
            return 'Jarvonia'
    
    # By region (use starting location's gear)
    if from_str in SYRENTHIA_LOCATIONS:
        gear_name = 'Diving'
        if 'Diving' in BREAKPOINTS:
            gear_name = 'Diving' if dist >= BREAKPOINTS['Diving'] else 'Diving_short'
        if gear_name in GEAR_SETS:
            return gear_name
        return 'Diving' if 'Diving' in GEAR_SETS else 'GDTE'
    
    if from_str in JARVONIA_LOCATIONS:
        gear_name = 'Jarvonia'
        if 'Jarvonia' in BREAKPOINTS:
            gear_name = 'Jarvonia' if dist >= BREAKPOINTS['Jarvonia'] else 'Jarvonia_short'
        if gear_name in GEAR_SETS:
            return gear_name
        return 'Jarvonia' if 'Jarvonia' in GEAR_SETS else 'GDTE'
    
    if from_str in SWAMP_LOCATIONS:
        if 'Swamp_2light' in GEAR_SETS:
            return 'Swamp_2light'
    
    # Default GDTE
    if 'GDTE' in BREAKPOINTS:
        gear_name = 'GDTE' if dist >= BREAKPOINTS['GDTE'] else 'GDTE_short'
        if gear_name in GEAR_SETS:
            return gear_name
    return 'GDTE' if 'GDTE' in GEAR_SETS else 'default'

class Graph:
    def __init__(self, enable_ring=True):
        self.edges = {}
        self.enable_ring = enable_ring
        self._build()
    
    def _build(self):
        """Build bidirectional graph."""
        for (a, b), data in RAW_ROUTES.items():
            dist = data['distance']
            req = data.get('requires', '')
            
            # Convert Location enums to strings for graph keys
            a_str = a.name if hasattr(a, 'name') else str(a)
            b_str = b.name if hasattr(b, 'name') else str(b)
            
            # Forward direction
            gear_ab = select_gear(a, b, req, dist)
            steps_ab = calc_steps(dist, gear_ab, location=a)  # Use starting location for stats
            
            # Reverse direction
            gear_ba = select_gear(b, a, req, dist)
            steps_ba = calc_steps(dist, gear_ba, location=b)  # Use starting location for stats
            
            if a_str not in self.edges:
                self.edges[a_str] = {}
            if b_str not in self.edges:
                self.edges[b_str] = {}
            
            self.edges[a_str][b_str] = {'steps': steps_ab, 'gear': gear_ab, 'base': dist}
            self.edges[b_str][a_str] = {'steps': steps_ba, 'gear': gear_ba, 'base': dist}

            # if Location.OLD_ARENA_RUINS.name in [a,b] and Location.HALFMAW_HIDEOUT.name in [a,b]:
            #     print("--GOTHERE--")
            #     print(a)
            #     print(b)
            #     print(self.edges[a][b])
            #     print(self.edges[b][a]) 
        
        # Add shortcuts (only if shorter than existing route)
        for (a, b, shortcut_name, unlocked), steps in SHORTCUTS.items():
            if unlocked:
                if a not in self.edges:
                    self.edges[a] = {}
                # Only add shortcut if it's shorter than existing route or no route exists
                if b not in self.edges[a] or steps < self.edges[a][b]['steps']:
                    self.edges[a][b] = {'steps': steps, 'gear': shortcut_name, 'base': steps}
        
        # Add Ring of Homesickness teleport from all locations
        if self.enable_ring:
            for loc in self.edges.keys():
                if loc != RING_TELEPORT_TARGET:
                    if loc not in self.edges:
                        self.edges[loc] = {}
                    self.edges[loc][RING_TELEPORT_TARGET] = {'steps': 0, 'gear': 'Ring', 'base': 0}
    
    def dijkstra(self, start: str, end: str) -> Tuple[List[str], int]:
        """Find shortest path between two locations."""
        if start not in self.edges or end not in self.edges:
            return [], float('inf')
        
        dist = {start: 0}
        prev = {}
        pq = [(0, start)]
        
        while pq:
            d, u = heapq.heappop(pq)
            if u == end:
                break
            if d > dist.get(u, float('inf')):
                continue
            
            for v, edge in self.edges.get(u, {}).items():
                alt = d + edge['steps']
                if alt < dist.get(v, float('inf')):
                    dist[v] = alt
                    prev[v] = u
                    heapq.heappush(pq, (alt, v))
        
        if end not in prev:
            return [], float('inf')
        
        path = []
        u = end
        while u in prev:
            path.append(u)
            u = prev[u]
        path.append(start)
        return path[::-1], dist[end]
    
    def find_tour(self, start: Union[Location, str], dests: List[Union[Location, str]], end: Union[Location, str, None] = None) -> Tuple[List[str], int, int, dict]:
        """Find optimal order to visit all destinations. Returns (route, steps, ring_uses, service_visits).
        
        Args:
            start: Starting location (Location enum or string)
            dests: List of destinations (Location enums or strings, can prefix with 'B:' bank, 'T:' trinketry, 'K:' cooking, 'C:' carpentry, 'S:' smithing, 'R:' crafting)
            end: Optional ending location (Location enum or string)
        """
        # Convert to strings
        start = to_str(start)
        end = to_str(end)
        dests = to_str_list(dests)
        
        # Parse service requirements from destinations
        def parse_services(dest_str):
            """Extract service requirements and clean destination. Returns (services_needed, clean_dest)."""
            services = []
            current = dest_str
            # Build prefix map using reflection
            prefix_map = {ServicePrefix[cat.name].value: cat for cat in ServiceCategory}
            while True:
                matched = False
                for prefix, category in prefix_map.items():
                    # Check for advanced variant (e.g., "TA:")
                    advanced_prefix = prefix[:-1] + "A:"
                    if current.startswith(advanced_prefix):
                        services.append((category, ServiceTier.ADVANCED))
                        current = current[len(advanced_prefix):]
                        matched = True
                        break
                    elif current.startswith(prefix):
                        services.append((category, ServiceTier.BASIC))
                        current = current[len(prefix):]
                        matched = True
                        break
                if not matched:
                    break
            return services, current
        
        # Parse all destinations
        dest_info = [parse_services(d) for d in dests]
        clean_dests = [dest for _, dest in dest_info]
        
        best_route, best_steps, best_rings, best_service_visits = None, float('inf'), 0, {}
        
        for perm in permutations(clean_dests):
            route = [start]
            total = 0
            ring_uses = 0
            valid = True
            services_visited = {}  # Track which services have been visited
            services_used = {}  # Track which services were actually used for requirements
            
            # Check if starting location has any services
            start_loc = None
            for loc in LOCATION_SERVICES:
                loc_name = loc.name if hasattr(loc, 'name') else str(loc)
                if loc_name == start:
                    start_loc = loc
                    break
            if start_loc and start_loc in LOCATION_SERVICES:
                for service_category, (tier, unlocked) in LOCATION_SERVICES[start_loc].items():
                    if unlocked:  # Only mark as visited if unlocked
                        services_visited[service_category] = start
            
            for i, dest in enumerate(perm):
                # Get required services for this destination
                required_services, _ = dest_info[clean_dests.index(dest)]
                
                # Visit each required service in order
                for service_category, tier in required_services:
                    if service_category in services_visited:
                        # Mark as used since it was required
                        services_used[service_category] = services_visited[service_category]
                        continue  # Already visited this service type
                    
                    # Get all locations with this service
                    service_locations = get_service_locations(service_category)
                    if not service_locations:
                        valid = False
                        break
                    
                    # Try to find service on the optimal path to destination
                    direct_path, direct_steps = self.dijkstra(route[-1], dest)
                    service_on_path = None
                    
                    for loc in direct_path:
                        if loc in service_locations:
                            service_on_path = loc
                            break
                    
                    if service_on_path:
                        # Service is on the path, mark it
                        services_visited[service_category] = service_on_path
                        services_used[service_category] = service_on_path
                    else:
                        # Find nearest service location
                        best_service_loc = None
                        best_service_steps = float('inf')
                        best_service_path = None
                        
                        for service_loc in service_locations:
                            path_to_service, steps_to_service = self.dijkstra(route[-1], service_loc)
                            path_from_service, steps_from_service = self.dijkstra(service_loc, dest)
                            total_via_service = steps_to_service + steps_from_service
                            
                            if total_via_service < best_service_steps:
                                best_service_loc = service_loc
                                best_service_steps = total_via_service
                                best_service_path = path_to_service
                        
                        if best_service_loc:
                            # Add service location to route
                            for j in range(len(best_service_path) - 1):
                                if self.edges[best_service_path[j]][best_service_path[j+1]]['gear'] == 'Ring':
                                    ring_uses += 1
                            route.extend(best_service_path[1:])
                            total += self.dijkstra(route[-len(best_service_path)], route[-1])[1]
                            services_visited[service_category] = best_service_loc
                            services_used[service_category] = best_service_loc
                
                if not valid:
                    break
                
                # Now go to the actual destination
                path, steps = self.dijkstra(route[-1], dest)
                if steps == float('inf'):
                    valid = False
                    break
                
                # Count ring uses in this path
                for j in range(len(path) - 1):
                    if self.edges[path[j]][path[j+1]]['gear'] == 'Ring':
                        ring_uses += 1
                
                route.extend(path[1:])
                total += steps
                
                # Check if we passed through any services
                for loc_str in path:
                    for loc_enum in LOCATION_SERVICES:
                        loc_name = loc_enum.name if hasattr(loc_enum, 'name') else str(loc_enum)
                        if loc_name == loc_str:
                            for service_category, (tier, unlocked) in LOCATION_SERVICES[loc_enum].items():
                                if unlocked and service_category not in services_visited:
                                    services_visited[service_category] = loc_str
                            break
            
            # If end location specified, go there
            if end and route[-1] != end:
                path, steps = self.dijkstra(route[-1], end)
                if steps == float('inf'):
                    valid = False
                else:
                    for j in range(len(path) - 1):
                        if self.edges[path[j]][path[j+1]]['gear'] == 'Ring':
                            ring_uses += 1
                    route.extend(path[1:])
                    total += steps
            
            if valid and total < best_steps:
                best_steps = total
                best_route = route
                best_rings = ring_uses
                best_service_visits = services_used.copy()
        
        return best_route or [start], best_steps, best_rings, best_service_visits
    
    def print_route(self, route: List[str], ring_uses: int = 0, service_visits: dict = None):
        """Print detailed route breakdown.
        
        Args:
            route: List of locations in order
            ring_uses: Number of Ring of Homesickness uses
            service_visits: Dict mapping service types to their visit locations
        """
        if service_visits is None:
            service_visits = {}
            
        if len(route) < 2:
            print("Invalid route")
            return
        
        print(f"\n{'='*60}")
        print(f"Route: {' → '.join(route)}")
        if ring_uses > 0:
            print(f"Ring of Homesickness uses: {ring_uses}")
        for service_type, location in service_visits.items():
            if location:
                print(f"{service_type.value} visit: {location}")
        print(f"{'='*60}\n")
        
        total = 0
        prev_gear = None
        services_shown = set()  # Track which services we've already shown
        
        for i in range(len(route) - 1):
            a, b = route[i], route[i+1]
            edge = self.edges[a][b]
            gear = edge['gear']
            steps = edge['steps']
            
            # Special handling for Ring and Shortcut
            if gear == 'Ring':
                print(f"Teleport to {b}")
                print()
                prev_gear = gear
                continue
            elif gear in [RUN_SHORTCUT, EXPLORE_BOG_BOTTOM, EXPLORE_UNDERWATER_CAVE]:
                service_suffix = ""
                for service_type, loc in service_visits.items():
                    if loc == a and service_type not in services_shown:
                        service_suffix += f" [{service_type.value}]"
                        services_shown.add(service_type)
                print(f"{a}{service_suffix} -> {gear}:")
                print(f"{steps} steps")
                print()
                total += steps
                prev_gear = gear
                continue
            
            # Print starting gear or gear switch
            if prev_gear is None:
                print(f"  [Starting Gear at {a}: {gear}]\n")
            elif gear != prev_gear and prev_gear not in ['Ring', 'Shortcut']:
                print(f"  [Gear Switch at {a}: {gear}]\n")
            
            suffix = " (short)" if "short" in gear else ""
            service_suffix = ""
            for service_type, loc in service_visits.items():
                if loc == a and service_type not in services_shown:
                    service_suffix += f" [{service_type.value}]"
                    services_shown.add(service_type)
            print(f"{a}{service_suffix} → {b}{suffix}:")
            print(f"{steps} steps")
            print()
            
            total += steps
            prev_gear = gear
        
        print(f"{'='*60}")
        print(f"Total Expected Steps: {total}")
        print(f"{'='*60}\n")

def main():
    graph = Graph(enable_ring=True)
    graph_no_ring = Graph(enable_ring=False)
    
    # Print breakpoints
    print("\nGear Breakpoints (base distance):")
    for region, bp in BREAKPOINTS.items():
        print(f"  {region}: {bp}")
    
    print(f"\nFinding optimal route for: {to_str_list(test_route)}")
    
    start = test_route[0]
    dests = test_route[1:]
    
    # Find route with ring
    route, steps, rings, service_visits = graph.find_tour(start, dests, ending)
    print(f"DEBUG: find_tour returned route with {len(route)} locations, {steps} steps, {rings} ring uses")
    graph.print_route(route, rings, service_visits)
    
    # If ring was used more than once, show alternative without ring
    if rings >= 2:
        print("\n" + "="*60)
        print("Alternative route (no Ring of Homesickness):")
        print("="*60)
        route_no_ring, steps_no_ring, _, bank_no_ring = graph_no_ring.find_tour(start, dests)
        graph_no_ring.print_route(route_no_ring, 0, bank_no_ring)


if __name__ == "__main__":
    main()
