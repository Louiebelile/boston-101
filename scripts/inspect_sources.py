import json, os, subprocess, sys, zipfile, traceback
import geopandas as gpd, pandas as pd
os.makedirs('raw', exist_ok=True); os.makedirs('report', exist_ok=True)
D='https://data.boston.gov/dataset/'
M='https://s3.us-east-1.amazonaws.com/download.massgis.digital.mass.gov/shapefiles'
T='https://www2.census.gov/geo/tiger/TIGER2024'
S={
 'buildings.zip':D+'08fd5249-2d75-42ef-ac23-951f3e0ec259/resource/57026638-b4e8-4dfa-8644-0e2cfe925a46/download/boston_buildings_with_roof_breaks_geojson.zip',
 'neighborhoods.geojson':D+'bf1a7b50-4c72-4637-b0fa-11d632e3aff1/resource/e5849875-a6f6-4c9c-9d8a-5048b0fbd03e/download/boston_neighborhood_boundaries.geojson',
 'public_schools.geojson':D+'4df4b9c7-239d-4643-ac21-a22b42c832df/resource/fd47065d-7f9a-4564-8090-aa9166b1b944/download/public_schools.geojson',
 'non_public_schools.geojson':D+'a8944f1a-aa6b-4d0c-8d68-e3b2338a9c34/resource/f6330a35-c451-4d10-90b7-7f038f355699/download/non_public_schools.geojson',
 'colleges.geojson':D+'7624a2d6-ca74-4fc1-9bba-d6e89d4ca9c7/resource/139b6ce0-ef39-48c7-aeb3-7b7f67b9d8af/download/colleges_and_universities.geojson',
 'council.geojson':D+'3e632d04-d7fe-4acd-bab7-75be4bdcfa96/resource/2d9092dd-5175-49ab-9b18-0c0efcef4153/download/city_council_districts___2023_2032.geojson',
 'article80.geojson':D+'f9788baa-9486-4a69-8d0a-91d4b6e1ed9d/resource/c1d0d9f7-ae0f-4213-94a1-4cd6a101cf07/download/article_80_development_projects_website.geojson',
 'main_streets.geojson':D+'a946d4ff-0ec9-4b2d-b18c-6e6944a92778/resource/315fa109-4a21-4999-a572-4cf793dbc29a/download/main_street_districts.geojson',
 'open_space.geojson':D+'66a3324e-066f-4caf-897b-a2b4dcb8bc42/resource/ccc038ce-5602-42d0-b4c6-87f60c116ea3/download/open_space.geojson',
 'landmarks.geojson':D+'92137315-e846-4c75-8c3d-2b7e93e38d03/resource/3660f6e1-4633-4c9f-aa21-1e6939626069/download/boston_landmarks_commission_blc_landmarks.geojson',
 'food.csv':D+'5e4182e3-ba1e-4511-88f8-08a70383e1b6/resource/f1e13724-284d-478c-b8bc-ef042aa5b70b/download/tmpn1g98wic.csv',
 'rapid.zip':M+'/state/mbta_rapid_transit.zip','trains.zip':M+'/state/trains.zip','towns.zip':M+'/state/townssurvey_shp.zip',
 'sldu.zip':T+'/SLDU/tl_2024_25_sldu.zip','sldl.zip':T+'/SLDL/tl_2024_25_sldl.zip','cd.zip':T+'/CD/tl_2024_25_cd119.zip',
}
out=open('report/report.txt','w')
def p(*a):
    s=' '.join(str(x) for x in a); print(s); out.write(s+'\n'); out.flush()
for f,u in S.items():
    r=subprocess.run(['curl','-sSL','-A','boston-101-data','-m','300','--retry','2','-o','raw/'+f,'-w','%{http_code} %{size_download}',u],capture_output=True,text=True)
    p('DOWNLOAD',f,r.stdout,r.stderr[:120])
def desc(name,g):
    p('\n###',name,'rows',len(g),'crs',getattr(g,'crs',None))
    p('columns',list(g.columns))
    if len(g):
        s=g.drop(columns=['geometry'],errors='ignore').iloc[0].to_dict(); p('sample',json.dumps({k:str(v)[:60] for k,v in s.items()}))
        if 'geometry' in g: p('geom',g.geometry.geom_type.value_counts().to_dict(),'bounds',list(g.total_bounds))
for f in S:
    pth='raw/'+f
    try:
        if f.endswith('.csv'):
            desc(f,pd.read_csv(pth,dtype=str,encoding_errors='replace'))
        elif f.endswith('.geojson'):
            desc(f,gpd.read_file(pth))
        else:
            with zipfile.ZipFile(pth) as z:
                names=z.namelist(); p('\nZIP',f,[n for n in names if n.lower().endswith(('.shp','.geojson','.json'))][:20])
                z.extractall('raw/'+f[:-4])
            for n in names:
                if n.lower().endswith(('.shp','.geojson')):
                    try: desc(f+':'+n,gpd.read_file('raw/%s/%s'%(f[:-4],n),rows=2000) if 'buildings' in f else gpd.read_file('raw/%s/%s'%(f[:-4],n)))
                    except Exception as e: p('ERR',n,e)
    except Exception as e:
        p('ERR',f,repr(e)[:300])
if os.path.exists('raw/neighborhoods.geojson'):
    g=gpd.read_file('raw/neighborhoods.geojson'); c=[x for x in g.columns if g[x].astype(str).str.contains('Dorchester').any()]; p('dorchester col',c, g[g[c[0]].astype(str).str.contains('Dorchester')][c[0]].tolist() if c else None)
