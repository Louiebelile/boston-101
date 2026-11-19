"""Build compact map files for a Boston 101 neighborhood lesson."""
import gzip, json, os, struct, subprocess, sys, zipfile
import numpy as np, pandas as pd, geopandas as gpd
from shapely import affinity
from shapely.geometry import LineString, MultiLineString, MultiPolygon, Point, Polygon, box, mapping
from shapely.ops import linemerge, polygonize, unary_union

HOOD = os.environ.get('HOOD', 'Dorchester')
SLUG = HOOD.lower().replace(' ', '-')
OUT = f'out/public/data/{SLUG}'
os.makedirs(OUT, exist_ok=True); os.makedirs('raw', exist_ok=True)
CRS = 26986
D = 'https://data.boston.gov/dataset/'
M = 'https://s3.us-east-1.amazonaws.com/download.massgis.digital.mass.gov/shapefiles'
T = 'https://www2.census.gov/geo/tiger/TIGER2024'
S = {
 'buildings.zip': D+'08fd5249-2d75-42ef-ac23-951f3e0ec259/resource/57026638-b4e8-4dfa-8644-0e2cfe925a46/download/boston_buildings_with_roof_breaks_geojson.zip',
 'neighborhoods.geojson': D+'bf1a7b50-4c72-4637-b0fa-11d632e3aff1/resource/e5849875-a6f6-4c9c-9d8a-5048b0fbd03e/download/boston_neighborhood_boundaries.geojson',
 'public_schools.geojson': D+'4df4b9c7-239d-4643-ac21-a22b42c832df/resource/fd47065d-7f9a-4564-8090-aa9166b1b944/download/public_schools.geojson',
 'non_public_schools.geojson': D+'a8944f1a-aa6b-4d0c-8d68-e3b2338a9c34/resource/f6330a35-c451-4d10-90b7-7f038f355699/download/non_public_schools.geojson',
 'colleges.geojson': D+'7624a2d6-ca74-4fc1-9bba-d6e89d4ca9c7/resource/139b6ce0-ef39-48c7-aeb3-7b7f67b9d8af/download/colleges_and_universities.geojson',
 'council.geojson': D+'3e632d04-d7fe-4acd-bab7-75be4bdcfa96/resource/2d9092dd-5175-49ab-9b18-0c0efcef4153/download/city_council_districts___2023_2032.geojson',
 'article80.geojson': D+'f9788baa-9486-4a69-8d0a-91d4b6e1ed9d/resource/c1d0d9f7-ae0f-4213-94a1-4cd6a101cf07/download/article_80_development_projects_website.geojson',
 'main_streets.geojson': D+'a946d4ff-0ec9-4b2d-b18c-6e6944a92778/resource/315fa109-4a21-4999-a572-4cf793dbc29a/download/main_street_districts.geojson',
 'open_space.geojson': D+'66a3324e-066f-4caf-897b-a2b4dcb8bc42/resource/ccc038ce-5602-42d0-b4c6-87f60c116ea3/download/open_space.geojson',
 'landmarks.geojson': D+'92137315-e846-4c75-8c3d-2b7e93e38d03/resource/3660f6e1-4633-4c9f-aa21-1e6939626069/download/boston_landmarks_commission_blc_landmarks.geojson',
 'food.csv': D+'5e4182e3-ba1e-4511-88f8-08a70383e1b6/resource/f1e13724-284d-478c-b8bc-ef042aa5b70b/download/tmpn1g98wic.csv',
 'rapid.zip': M+'/state/mbta_rapid_transit.zip', 'trains.zip': M+'/state/trains.zip', 'towns.zip': M+'/state/townssurvey_shp.zip',
 'sldu.zip': T+'/SLDU/tl_2024_25_sldu.zip', 'sldl.zip': T+'/SLDL/tl_2024_25_sldl.zip', 'cd.zip': T+'/CD/tl_2024_25_cd119.zip',
}
report = []
def log(*a):
    s = ' '.join(str(x) for x in a); print(s, flush=True); report.append(s)
for f, u in S.items():
    p = 'raw/' + f
    if not os.path.exists(p):
        subprocess.run(['curl', '-sSL', '-A', 'boston-101-data', '-m', '400', '--retry', '3', '-o', p, u], check=True)
    if f.endswith('.zip') and not os.path.isdir(p[:-4]):
        zipfile.ZipFile(p).extractall(p[:-4])

hoods = gpd.read_file('raw/neighborhoods.geojson').to_crs(CRS)
towns = gpd.read_file('raw/towns/TOWNSSURVEY_POLYM.shp').to_crs(CRS)
hood = unary_union(hoods[hoods['name'] == HOOD].geometry.values).buffer(0)
land_all = unary_union(towns.cx[hood.bounds[0]-6000:hood.bounds[2]+6000, hood.bounds[1]-6000:hood.bounds[3]+6000].geometry.values).buffer(0)
hood_land = hood.intersection(land_all).buffer(0)
c = hood_land.envelope.centroid
OX, OY = round(c.x / 10) * 10, round(c.y / 10) * 10
b = hood_land.bounds; M_ = 1800
rect = box(b[0]-M_, b[1]-M_, b[2]+M_, b[3]+M_)
log('hood bounds', [round(x) for x in b], 'origin', OX, OY)
ll = gpd.GeoSeries([rect], crs=CRS).to_crs(4326).total_bounds
S_, W_, N_, E_ = ll[1], ll[0], ll[3], ll[2]

def xy(arr):
    return [int(round(v)) for p in arr for v in (p[0]-OX, p[1]-OY)]
def polys(g):
    if g.is_empty: return []
    gs = [g] if isinstance(g, Polygon) else [x for x in getattr(g, 'geoms', []) if isinstance(x, Polygon)]
    return [[xy(list(p.exterior.coords)[:-1])] + [xy(list(r.coords)[:-1]) for r in p.interiors if Polygon(r).area > 900] for p in gs if p.area > 600]
def lines(g):
    if g.is_empty: return []
    gs = [g] if isinstance(g, LineString) else [x for x in getattr(g, 'geoms', []) if isinstance(x, LineString)]
    return [xy(l.coords) for l in gs if l.length > 8]

# Water, roads from OpenStreetMap
q = f'[out:json][timeout:240];(way["highway"~"^(motorway|motorway_link|trunk|primary|secondary|tertiary|residential|unclassified|living_street)$"]({S_},{W_},{N_},{E_});way["natural"="water"]({S_},{W_},{N_},{E_});relation["natural"="water"]({S_},{W_},{N_},{E_});way["waterway"="riverbank"]({S_},{W_},{N_},{E_}););out geom;'
if not os.path.exists('raw/osm.json'):
    for ep in ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']:
        r = subprocess.run(['curl', '-sS', '-m', '300', '-A', 'boston-101-data', ep, '--data-urlencode', 'data@-', '-o', 'raw/osm.json', '-w', '%{http_code}'], input=q, capture_output=True, text=True)
        log('overpass', ep, r.stdout, r.stderr[:100])
        if r.stdout == '200': break
osm = json.load(open('raw/osm.json'))['elements']
def pts(g): return [(p['lon'], p['lat']) for p in g]
road_rows, water_geoms = [], []
for e in osm:
    t = e.get('tags', {})
    if e['type'] == 'way' and 'highway' in t and 'geometry' in e:
        road_rows.append({'k': t['highway'], 'ref': t.get('ref', ''), 'name': t.get('name', ''), 'bridge': t.get('bridge', ''), 'tunnel': t.get('tunnel', ''), 'geometry': LineString(pts(e['geometry']))})
    elif e['type'] == 'way' and 'geometry' in e and len(e['geometry']) > 3:
        p = Polygon(pts(e['geometry']))
        if p.is_valid and p.area > 0: water_geoms.append(p)
    elif e['type'] == 'relation':
        outer = [LineString(pts(m['geometry'])) for m in e.get('members', []) if m.get('role') == 'outer' and m.get('geometry')]
        inner = [LineString(pts(m['geometry'])) for m in e.get('members', []) if m.get('role') == 'inner' and m.get('geometry')]
        o = list(polygonize(linemerge(outer) if len(outer) > 1 else outer))
        i = list(polygonize(linemerge(inner) if len(inner) > 1 else inner)) if inner else []
        if o: water_geoms.append(unary_union(o).difference(unary_union(i)) if i else unary_union(o))
roads = gpd.GeoDataFrame(road_rows, crs=4326).to_crs(CRS)
roads['geometry'] = roads.geometry.intersection(rect)
roads = roads[~roads.geometry.is_empty]
water = gpd.GeoSeries(water_geoms, crs=4326).to_crs(CRS).buffer(0)
water_u = unary_union([g for g in water.values if g.area > 1500]).intersection(rect).simplify(4).buffer(0)
def road_group(kinds, tol):
    g = roads[roads.k.isin(kinds)]
    out = []
    for geom in g.geometry.simplify(tol).values: out += lines(geom)
    return out
i93 = roads[(roads.ref.str.contains('I 93', na=False)) & (roads.k == 'motorway')]

# Land layers
land = land_all.intersection(rect).difference(water_u).simplify(5).buffer(0)
main = hood_land.difference(water_u).simplify(3).buffer(0)
other = land.difference(main.buffer(1)).buffer(0)
opn = gpd.read_file('raw/open_space.geojson').to_crs(CRS)
opn = opn[opn.intersects(rect)]
green = opn[opn.TypeLong.fillna('').str.contains('Parks|Urban Wild|Natural|Cemeter|Parkway|Community Garden', regex=True)]
parks = unary_union(green.geometry.buffer(0).values).intersection(main).simplify(3).buffer(0)
rng = np.random.default_rng(101)
trees = []
for p in (parks.geoms if hasattr(parks, 'geoms') else [parks]):
    if p.area < 1500: continue
    n = min(90, int(p.area / 2600)); x0, y0, x1, y1 = p.bounds; got = 0; tries = 0
    while got < n and tries < n * 12:
        tries += 1; x, y = rng.uniform(x0, x1), rng.uniform(y0, y1)
        if p.contains(Point(x, y)): trees += [int(x-OX), int(y-OY)]; got += 1

# Rail
arc = gpd.read_file('raw/rapid/MBTA_ARC.shp').to_crs(CRS); node = gpd.read_file('raw/rapid/MBTA_NODE.shp').to_crs(CRS)
log('rapid routes', sorted(set(zip(arc.LINE.astype(str), arc.ROUTE.astype(str)))))
def stitch(gs):
    m = linemerge([l for g in gs for l in (g.geoms if isinstance(g, MultiLineString) else [g])])
    ls = list(m.geoms) if isinstance(m, MultiLineString) else [m]
    ls.sort(key=lambda l: -l.length); path = list(ls.pop(0).coords)
    while ls:
        best = None
        for i, l in enumerate(ls):
            c = list(l.coords)
            for rev in (False, True):
                cc = c[::-1] if rev else c
                for end in (True, False):
                    a = path[-1] if end else path[0]; d = np.hypot(a[0]-cc[0 if end else -1][0], a[1]-cc[0 if end else -1][1])
                    if best is None or d < best[0]: best = (d, i, cc, end)
        d, i, cc, end = best; ls.pop(i)
        if d > 500: continue
        path = path + cc if end else cc + path
    return LineString(path)
def north_first(l):
    c = list(l.coords); return LineString(c if c[0][1] > c[-1][1] else c[::-1])
red = arc[arc.LINE.astype(str).str.upper().str.contains('RED')]
ash = red[red.ROUTE.astype(str).str.contains('Ashmont') & ~red.ROUTE.astype(str).str.contains('Mattapan')]
mat = red[red.ROUTE.astype(str).str.contains('Mattapan')]
bra = red[red.ROUTE.astype(str).str.contains('Braintree')]
rail = {}
for k, df in (('ashmont', ash), ('mattapan', mat), ('braintree', bra)):
    if len(df):
        g = [x for x in df.geometry.intersection(rect.buffer(600)).values if not x.is_empty]
        if g: rail[k] = xy(north_first(stitch(g)).simplify(2).coords)
tr = gpd.read_file('raw/trains/TRAINS_RTE_TRAIN.shp').to_crs(CRS)
log('commuter lines', tr.COMM_LINE.tolist())
fm = tr[tr.COMM_LINE.astype(str).str.contains('Fairmount', case=False)]
if len(fm):
    g = [x for x in fm.geometry.intersection(rect.buffer(600)).values if not x.is_empty]
    if g: rail['fairmount'] = xy(north_first(stitch(g)).simplify(2).coords)
stations = []
for _, r in node[node.intersects(rect)].iterrows():
    if 'RED' in str(r.LINE).upper(): stations.append({'name': r.STATION, 'line': 'red', 'route': str(r.ROUTE), 'x': int(r.geometry.x-OX), 'y': int(r.geometry.y-OY)})
tn = gpd.read_file('raw/trains/TRAINS_NODE.shp').to_crs(CRS)
for _, r in tn[tn.intersects(rect) & tn.LINE_BRNCH.astype(str).str.contains('FAIRMOUNT', case=False)].iterrows():
    stations.append({'name': str(r.STATION).title(), 'line': 'fairmount', 'x': int(r.geometry.x-OX), 'y': int(r.geometry.y-OY)})
log('stations', [(s['name'], s['line']) for s in stations])

# Tank location (Commercial Point)
tank = gpd.GeoSeries([Point(-71.045167, 42.3014528)], crs=4326).to_crs(CRS).iloc[0]

# Buildings
bld = gpd.read_file('raw/buildings/Boston_Buildings_with_Roof_Breaks.geojson', bbox=tuple(gpd.GeoSeries([hood_land.buffer(60)], crs=CRS).to_crs(4326).total_bounds), columns=['PART_USE', 'Land_Use', 'BLDG_HGT_2010', 'IEL_TYPE']).to_crs(CRS)
log('buildings in box', len(bld), bld.PART_USE.value_counts().head(25).to_dict(), bld.IEL_TYPE.value_counts().head(8).to_dict())
bld = bld[bld.geometry.representative_point().within(hood_land.buffer(25))].copy()
bld = bld[bld.geometry.distance(tank) > 45]
log('buildings in neighborhood', len(bld))
TYPE = {'R1': 1, 'R2': 2, 'R3': 3, 'R4': 4, 'A': 4, 'RC': 4, 'CM': 4, 'CD': 4, 'CP': 8, 'C': 5, 'CC': 5, 'CL': 5, 'CO': 5, 'E': 6, 'EA': 6, 'EX': 6, 'I': 7, 'AH': 0}
rows = []
for geom, use, lu, h in zip(bld.geometry.values, bld.PART_USE.values, bld.Land_Use.values, bld.BLDG_HGT_2010.values):
    for p in (geom.geoms if hasattr(geom, 'geoms') else [geom]):
        if p.area < 14: continue
        u = str(use if use not in (None, '') and str(use) != 'nan' else lu).strip().upper(); ty = TYPE.get(u, 0)
        ht = float(h) if h is not None and np.isfinite(h) and h > 0 else 22.0
        ht = min(max(ht * 0.3048, 2.6), 120)
        mr = p.minimum_rotated_rectangle; rect_like = p.area < 700 and p.area / max(mr.area, 1) > .78
        if rect_like:
            co = list(mr.exterior.coords)[:-1]
            if np.hypot(co[1][0]-co[0][0], co[1][1]-co[0][1]) < np.hypot(co[2][0]-co[1][0], co[2][1]-co[1][1]): co = co[1:] + co[:1]
        else:
            s = p.simplify(1.0).buffer(0)
            if s.is_empty or not isinstance(s, Polygon): continue
            co = list(s.exterior.coords)[:-1]; tol = 1.6
            while len(co) > 28:
                s2 = p.simplify(tol).buffer(0); tol *= 1.5
                if isinstance(s2, Polygon) and not s2.is_empty: co = list(s2.exterior.coords)[:-1]
        if len(co) < 3: continue
        ring = Polygon(co)
        if not ring.exterior.is_ccw: co = co[::-1]
        gable = rect_like and ty in (1, 2) and ht < 13
        rows.append((int((p.centroid.x-OX+9000)//250), int((p.centroid.y-OY+9000)//250), ty, gable, ht, co))
rows.sort(key=lambda r: (r[0], r[1]))
ns = np.array([len(r[5]) for r in rows], np.uint8); ty = np.array([r[2] for r in rows], np.uint8); fl = np.array([1 if r[3] else 0 for r in rows], np.uint8); hs = np.array([round(r[4]*10) for r in rows], np.uint16)
xs, ys = [], []
for r in rows:
    px = [int(round((p[0]-OX)*2)) for p in r[5]]; py = [int(round((p[1]-OY)*2)) for p in r[5]]
    xs += [px[0]] + [px[i]-px[i-1] for i in range(1, len(px))]; ys += [py[0]] + [py[i]-py[i-1] for i in range(1, len(py))]
xs = np.array(xs, np.int16); ys = np.array(ys, np.int16)
raw = b'BLD1' + struct.pack('<II', len(rows), len(xs)) + ns.tobytes() + ty.tobytes() + fl.tobytes() + hs.tobytes() + xs.tobytes() + ys.tobytes()
with gzip.GzipFile(f'{OUT}/buildings.pak', 'wb', 9, mtime=0) as z: z.write(raw)
log('buildings written', len(rows), 'corners', len(xs), 'raw', len(raw), 'pak', os.path.getsize(f'{OUT}/buildings.pak'))

base = {'name': HOOD, 'origin': [OX, OY], 'crs': 'EPSG:26986', 'rect': [int(rect.bounds[0]-OX), int(rect.bounds[1]-OY), int(rect.bounds[2]-OX), int(rect.bounds[3]-OY)],
 'main': polys(main), 'other': polys(other), 'parks': polys(parks), 'water': polys(water_u),
 'roads': {'motorway': road_group(['motorway'], 3), 'link': road_group(['motorway_link'], 3), 'major': road_group(['trunk', 'primary', 'secondary'], 2), 'mid': road_group(['tertiary'], 2), 'minor': road_group(['residential', 'unclassified', 'living_street'], 2)},
 'i93': [xy(l.coords) for g in i93.geometry.values for l in (g.geoms if hasattr(g, 'geoms') else [g])], 'rail': rail, 'stations': stations, 'trees': trees, 'tank': [int(tank.x-OX), int(tank.y-OY)]}
with gzip.open(f'{OUT}/base.pak', 'wt', 9) as z: json.dump(base, z, separators=(',', ':'))
log('base', os.path.getsize(f'{OUT}/base.pak'), {k: len(v) for k, v in base['roads'].items()}, 'trees', len(trees)//2)

# Lesson points
inside = hood_land.buffer(40)
def pt_rows(g, fields):
    g = g.to_crs(CRS); g = g[g.within(inside)]
    return [dict({k: (None if pd.isna(r[v]) else str(r[v]).strip()) for k, v in fields.items()}, x=int(r.geometry.x-OX), y=int(r.geometry.y-OY)) for _, r in g.iterrows()]
L = {}
L['publicSchools'] = pt_rows(gpd.read_file('raw/public_schools.geojson'), {'name': 'SCH_NAME', 'address': 'ADDRESS', 'type': 'SCH_TYPE'})
L['otherSchools'] = pt_rows(gpd.read_file('raw/non_public_schools.geojson'), {'name': 'NAME', 'address': 'ADDRESS', 'type': 'TYPE', 'grades': 'GRADES'})
L['colleges'] = pt_rows(gpd.read_file('raw/colleges.geojson'), {'name': 'Name', 'address': 'Address'})
a = gpd.read_file('raw/article80.geojson')
L['projects'] = pt_rows(a[a.neighborhood.astype(str).str.contains(HOOD, case=False)], {'name': 'project__project_name', 'status': 'project_status', 'units': 'total_residential_units', 'url': 'website_url', 'filed': 'last_filed_date'})
f = pd.read_csv('raw/food.csv', dtype=str, encoding_errors='replace'); f['lon'] = pd.to_numeric(f.longitude, errors='coerce'); f['lat'] = pd.to_numeric(f.latitude, errors='coerce'); f = f.dropna(subset=['lon', 'lat'])
fg = gpd.GeoDataFrame(f, geometry=gpd.points_from_xy(f.lon, f.lat), crs=4326)
L['food'] = pt_rows(fg, {'name': 'businessname', 'dba': 'dbaname', 'address': 'address', 'category': 'descript'})
lm = gpd.read_file('raw/landmarks.geojson'); lm = lm[lm.Neighborhood.astype(str).str.contains(HOOD, case=False)].to_crs(CRS)
L['landmarks'] = [{'name': r.Common_Name, 'status': r.Status, 'x': int(r.geometry.representative_point().x-OX), 'y': int(r.geometry.representative_point().y-OY)} for _, r in lm.iterrows()]
ms = gpd.read_file('raw/main_streets.geojson').to_crs(CRS); ms = ms[ms.intersects(hood_land)]
L['mainStreets'] = [{'name': r.DIST_NAME, 'rings': polys(r.geometry.simplify(4))} for _, r in ms.iterrows()]
def districts(g, name):
    g = g.to_crs(CRS); out = []
    for _, r in g[g.intersects(hood_land)].iterrows():
        over = r.geometry.intersection(hood_land)
        if over.area / hood_land.area < .008: continue
        out.append({'name': name(r), 'share': round(over.area/hood_land.area, 3), 'rings': polys(over.simplify(8).buffer(0))})
    return sorted(out, key=lambda d: -d['share'])
L['council'] = districts(gpd.read_file('raw/council.geojson'), lambda r: f"District {r.DISTRICT}")
L['stateSenate'] = districts(gpd.read_file('raw/sldu/tl_2024_25_sldu.shp'), lambda r: r.NAMELSAD)
L['stateHouse'] = districts(gpd.read_file('raw/sldl/tl_2024_25_sldl.shp'), lambda r: r.NAMELSAD)
L['congress'] = districts(gpd.read_file('raw/cd/tl_2024_25_cd119.shp'), lambda r: r.NAMELSAD)
with gzip.open(f'{OUT}/layers.pak', 'wt', 9) as z: json.dump(L, z, separators=(',', ':'))
log('layers', os.path.getsize(f'{OUT}/layers.pak'), {k: len(v) for k, v in L.items()})
log('council', [(d['name'], d['share']) for d in L['council']]); log('senate', [(d['name'], d['share']) for d in L['stateSenate']]); log('house', [(d['name'], d['share']) for d in L['stateHouse']]); log('congress', [(d['name'], d['share']) for d in L['congress']])
log('landmarks', [d['name'] for d in L['landmarks']]); log('public schools', len(L['publicSchools']), 'other', len(L['otherSchools']), [d['name'] for d in L['colleges']])
os.makedirs('out/report', exist_ok=True); open('out/report/build.txt', 'w').write('\n'.join(report))
