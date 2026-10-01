"""Rebuild branded, editable documentation diagrams. Requires Graphviz `dot`."""
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
CREAM, RED, LIME, INK = '#FAF6EB', '#BA3143', '#D8F24B', '#291B1D'
BASE = '''graph [bgcolor="#FAF6EB", fontname="Arial", fontsize=24, fontcolor="#BA3143", labelloc=t, labeljust=l, pad=0.4, nodesep=0.45, ranksep=0.6, splines=polyline, dpi=144];
node [shape=box, style="rounded,filled", fillcolor="#FAF6EB", color="#BA3143", fontcolor="#291B1D", fontname="Arial", fontsize=16, margin="0.22,0.15", penwidth=1.3];
edge [color="#BA3143", fontcolor="#291B1D", fontname="Arial", fontsize=13, arrowsize=0.7, penwidth=1.3];
'''
ENDPOINT = 'shape=oval, fillcolor="#BA3143", fontcolor="#FAF6EB"'
DECISION = 'shape=diamond, style=filled, fillcolor="#D8F24B", margin="0.12,0.1"'

def make(name, title, body, description):
    dot = 'digraph G {\n' + BASE + f'label="{title}";\n' + body + '\n}\n'
    (HERE / f'{name}.dot').write_text(dot)
    for fmt in ('svg', 'png'):
        subprocess.run(['dot', f'-T{fmt}', str(HERE / f'{name}.dot'), '-o', str(HERE / f'{name}.{fmt}')], check=True)
    path = HERE / f'{name}.svg'
    # Graphviz's XML output gets an accessible title and description.
    tree = ET.parse(path)
    root = tree.getroot()
    root.set('role', 'img')
    root.set('aria-labelledby', f'{name}-title {name}-desc')
    ns = '{http://www.w3.org/2000/svg}'
    title_el = ET.Element(ns+'title', {'id': f'{name}-title'})
    title_el.text = title.replace('\\n', ' — ')
    desc_el = ET.Element(ns+'desc', {'id': f'{name}-desc'})
    desc_el.text = description
    root.insert(0, desc_el); root.insert(0, title_el)
    ET.register_namespace('', 'http://www.w3.org/2000/svg')
    tree.write(path, encoding='utf-8', xml_declaration=True)

make('overview', 'Your race becomes a story worth keeping', '''
rankdir=LR;
timing [label="Race results\\nTime · pace · placing\\nKilometer-by-kilometer performance", fillcolor="#D8F24B"];
recap [label="Your personal recap\\nUnderstand your race highlights\\nView on phone or computer", fillcolor="#BA3143", fontcolor="#FAF6EB"];
image [label="Save and share\\nExport your recap as an image"];
strava [label="Optional Strava detail\\nHeart rate · elevation\\nCadence · calories"];
photos [label="Optional race photos\\nMatched using your BIB number"];
timing -> recap [label="build the baseline"];
recap -> image [label="when you choose"];
strava -> recap [style=dashed, label="with your permission"];
photos -> recap [style=dashed, label="when matches exist"];
{rank=same; timing; strava; photos;}
note [shape=plaintext, label="Soekarno Run 2027 · 5K and 10K\\nTiming and photo matching use sample data.\\nYour recap still works without Strava or photos.", fontsize=14];
image -> note [style=invis];
''', 'Sample timing results form the baseline recap. Strava metrics and BIB-matched photos are optional additions. The runner chooses whether to export an image. This is a 5K and 10K prototype with simulated timing and photo matching.')

make('runner-flow', 'Runner journey: find, understand and share your race', f'''
rankdir=TB;
start [{ENDPOINT}, label="Open Marathon Wrapped"];
select [label="Select your runner result\\nusing its identifier / BIB"];
found [{DECISION}, label="Matching result\\navailable?"];
missing [label="Result unavailable\\nReturn to selection or retry\\nNo other runner’s data is shown"];
finish [{DECISION}, label="Recorded as a\\nvalid finisher?"];
normal [label="See your finish time, pace and ranks\\nExplore recorded split highlights"];
dnf [label="See your DNF recap\\nNo invented finish time or pace\\nShow only available information"];
view [label="Your baseline recap is available", fillcolor="#BA3143", fontcolor="#FAF6EB"];
optional [label="Optional: add available Strava detail\\nor explore BIB-matched photos\\nYou can continue without either"];
export [{DECISION}, label="Export an image?"];
create [label="Generate your recap image"];
success [{DECISION}, label="Image generated?"];
error [label="See an export error and retry\\nYour recap and stored results remain"];
save [{ENDPOINT}, label="Save or share your image"];
end [{ENDPOINT}, label="Keep viewing your recap"];
start -> select -> found;
found -> finish [label="Yes"];
found -> missing [label="No"];
missing -> select [label="Return / retry", constraint=false];
finish -> normal [label="Yes"];
finish -> dnf [label="No: known DNF"];
{{rank=same; normal; dnf;}}
normal -> view; dnf -> view;
view -> optional -> export;
export -> create [label="Yes"];
export -> end [label="No"];
create -> success;
success -> save [label="Yes"];
success -> error [label="No"];
error -> create [label="Retry", constraint=false];
''', 'The runner selects an identifier or BIB. Missing results return to selection or retry. Valid finishers see recorded race statistics; known DNF runners see an honest DNF state. Optional enrichment never blocks the baseline. Image export can succeed or show a retryable error without changing results.')

make('strava-flow', 'Strava is your choice: extra detail, never a prerequisite', f'''
rankdir=TB;
base [{ENDPOINT}, label="Baseline recap is already available"];
choose [{DECISION}, label="Choose Connect\\nStrava?"];
consent [label="Review Strava’s permission request"];
approved [{DECISION}, label="Authorize the\\nconnection?"];
request [label="Request available running metrics"];
returned [{DECISION}, label="Usable metrics\\nreturned?"];
show [label="Add the available metrics\\nDo not invent missing values"];
fallback [label="Continue with the baseline recap\\nSkip, denied consent or service failure\\nnever removes your race results"];
connected [label="View your enriched recap", fillcolor="#BA3143", fontcolor="#FAF6EB"];
disconnect [{DECISION}, label="Choose\\nDisconnect?"];
remove [label="Remove or invalidate connection data\\nStop displaying connected metrics\\nKeep baseline results available"];
end [{ENDPOINT}, label="Continue viewing your recap"];
base -> choose;
choose -> consent [label="Yes"];
choose -> fallback [label="No / skip"];
consent -> approved;
approved -> request [label="Yes"];
approved -> fallback [label="No / deny"];
request -> returned;
returned -> show [label="Yes, even if partial"];
returned -> fallback [label="No / failed request"];
show -> connected -> disconnect;
disconnect -> remove [label="Yes: successful disconnection"];
disconnect -> end [label="No"];
remove -> end;
fallback -> end;
note [shape=plaintext, fontsize=13, label="Failed disconnection retry behavior remains OD-05.\\nStrava credentials never appear in the recap or export."];
end -> note [style=invis];
''', 'The runner may skip Strava, deny permission, or authorize available metrics. Failed requests fall back to the baseline. Connected runners may disconnect; successful disconnection removes or invalidates the connection while preserving timing results. Failure recovery for disconnection remains an open decision.')

make('organizer-flow', 'Organizer journey: keep the demonstration ready', f'''
rankdir=TB;
start [{ENDPOINT}, label="Open the organizer view"];
results [label="View all seeded event results\\nSoekarno Run 2027 · 5K and 10K"];
manage [{DECISION}, label="Create or update\\na demo runner?"];
edit [label="Enter or edit the runner’s demo data\\nResults · splits · optional metrics / photos"];
valid [{DECISION}, label="Save accepted?"];
error [label="Read the rejection reason\\nCorrect the data and try again\\nA failed save is not reported as success"];
saved [label="Saved data appears in the event results\\nAssigned BIB remains unchanged", fillcolor="#BA3143", fontcolor="#FAF6EB"];
end [{ENDPOINT}, label="Ready for the demonstration"];
start -> results -> manage;
manage -> edit [label="Yes"];
manage -> end [label="No"];
edit -> valid;
valid -> saved [label="Yes"];
valid -> error [label="No"];
error -> edit [label="Correct / retry", constraint=false];
saved -> end;
note [shape=plaintext, fontsize=14, label="Dataset: at least 3 complete hero runners\\nplus DNF, no-Strava and no-photo test cases.\\nBIB uniqueness and valid record relationships apply.\\nAccess enforcement remains OD-04; save atomicity remains OD-07."];
end -> note [style=invis];
''', 'The organizer views all event results, then optionally creates or updates demonstration runners through the interface. Rejected saves show a correction path. The dataset needs three complete hero runners and DNF, missing-Strava and missing-photo cases. Organizer access and atomic saves require further team decisions.')

make('use-case-diagram', 'Use cases: what runners and organizers need to do', '''
rankdir=LR;
node [fontsize=15];
runner [shape=box, style=filled, fillcolor="#BA3143", fontcolor="#FAF6EB", label="«actor»\\nRunner"];
organizer [shape=box, style=filled, fillcolor="#BA3143", fontcolor="#FAF6EB", label="«actor»\\nOrganizer"];
strava [shape=box, style=filled, fillcolor="#D8F24B", label="«actor»\\nStrava service\\nExternal, opt-in"];
subgraph cluster_system {
 label="Marathon Wrapped prototype"; color="#BA3143"; fontcolor="#291B1D"; fontsize=18; style=rounded; margin=24;
 node [shape=ellipse, style=filled];
 recap [label="View my personal race recap\\nUR-F1 · UR-F7"];
 insights [label="Understand my split performance\\nUR-F2"];
 connect [label="Connect Strava for extra detail\\nUR-F3"];
 disconnect [label="Disconnect Strava\\nUR-F4"];
 photos [label="View my matched race photos\\nUR-F5"];
 export [label="Export / share my recap image\\nUR-F6"];
 results [label="View event results\\nUR-F8"];
 manage [label="Manage hero-runner demo data\\nCreate · update · replace\\nUR-F9"];
 {rank=same; recap; insights; connect; disconnect; photos; export;}
 {rank=same; results; manage;}
 recap -> insights -> connect -> disconnect -> photos -> export [style=invis];
 results -> manage [style=invis];
}
edge [dir=none];
runner -> recap; runner -> insights; runner -> connect; runner -> disconnect; runner -> photos; runner -> export;
results -> organizer; manage -> organizer;
connect -> strava;
note [shape=plaintext, fontsize=14, label="Associations show participation, not an action sequence.\\nStrava is optional; photos may be absent; DNF has a valid recap.\\nAlternative outcomes are specified in FS-01 through FS-08."];
export -> note [style=invis];
''', 'UML actors are shown with actor stereotypes. The runner has six goals: view the recap, understand splits, connect or disconnect Strava, view photos, and export an image. The organizer views results and manages hero data. Strava participates in voluntary connection and enrichment. Associations are not sequence arrows.')

make('activity-diagram', 'UML activity: an honest recap, then a safe export', f'''
rankdir=TB;
node [fontsize=15];
initial [shape=circle, style=filled, fillcolor="#291B1D", color="#291B1D", width=0.18, height=0.18, label=""];
select [label="Runner: select own result"];
retrieve [label="Application: retrieve matching result"];
found [{DECISION}, label="Result exists?"];
notfound [label="Application: show result unavailable"];
return [label="Runner: return to selection or retry"];
finish [{DECISION}, label="Known valid\\nfinisher?"];
calculate [label="Application: calculate baseline statistics\\nand supported split insights"];
dnf [label="Application: prepare DNF content\\nOmit fabricated finish time / pace"];
merge [shape=diamond, style=filled, fillcolor="#D8F24B", width=0.35, height=0.3, label=""];
optional [label="Application: add available optional data\\nShow no-photo state if no matches"];
render [label="Application: render selected runner’s recap"];
export [{DECISION}, label="Runner chooses\\nexport?"];
generate [label="Application: generate recap image"];
success [{DECISION}, label="Export succeeds?"];
share [label="Runner: save / share generated image"];
error [label="Application: show actionable export error\\nPreserve recap and stored result data"];
retry [label="Runner: retry export"];
final [shape=doublecircle, style=filled, fillcolor="#291B1D", color="#291B1D", width=0.2, height=0.2, label=""];
initial -> select -> retrieve -> found;
found -> finish [label="[matching result]"];
found -> notfound [label="[no matching result]"];
notfound -> return;
return -> select [constraint=false];
finish -> calculate [label="[finisher]"];
finish -> dnf [label="[known DNF]"];
{{rank=same; calculate; dnf;}}
calculate -> merge; dnf -> merge;
merge -> optional -> render -> export;
export -> generate [label="[export selected]"];
export -> final [label="[continue viewing]"];
generate -> success;
success -> share [label="[success]"];
success -> error [label="[failure]"];
error -> retry;
retry -> generate [constraint=false];
share -> final;
''', 'UML initial and final nodes, action nodes, decision and merge diamonds, and guarded transitions represent the runner/application recap flow. Missing results loop to selection. Finisher and known-DNF paths merge before optional data and rendering. Export failure preserves results and allows retry.')

make('class-diagram', 'UML classes: the information behind a personal recap', '''
rankdir=TB;
node [shape=record, style=filled, fontsize=16, fillcolor="#FAF6EB"];
event [label="{Event|Name\\lDate\\lLocation\\l}", fillcolor="#BA3143", fontcolor="#FAF6EB"];
category [label="{RaceCategory|5K or 10K\\lDistance\\lMinimum age\\l}"];
runner [label="{Runner|Name and contact details\\lAssigned BIB (unique, stable)\\lRegistration details\\l}", fillcolor="#D8F24B"];
result [label="{RaceResult|Start / finish time\\lElapsed time and pace\\lCategory / overall rank\\lFinisher or DNF\\l}"];
split [label="{KilometerSplit|Kilometer marker\\lTime for this kilometer\\l}"];
metrics [label="{StravaMetrics|Heart rate\\lElevation gain\\lCalories and cadence\\l}"];
photo [label="{RacePhoto|Runner BIB\\lImage location\\lPhotographer and capture details\\l}"];
edge [dir=none, fontsize=13, labeldistance=2.0];
event -> category [taillabel="1", headlabel="0..*", minlen=2, labelangle=35];
category -> runner [taillabel="1", headlabel="0..*", minlen=2, labelangle=35];
runner -> result [taillabel="1", headlabel="1", label="seeded runner’s result"];
runner -> split [taillabel="1", headlabel="0..*", label="recorded kilometers"];
runner -> metrics [taillabel="1", headlabel="0..1", label="optional detail"];
runner -> photo [taillabel="1", headlabel="0..*", label="matched by BIB"];
{rank=same; result; split; metrics; photo;}
note [shape=plaintext, fontsize=14, label="Conceptual classes, not a database schema.\\n0..1 = optional, at most one · 0..* = zero or more.\\nFinishers have one split per kilometer; DNF may have partial splits.\\nExactly one result per seeded demo runner; lifecycle is OD-01."];
split -> note [style=invis];
''', 'One event has race categories; each category groups runners. Each seeded demonstration runner has one result and recorded kilometer splits. Strava metrics are optional at most one, and BIB-matched race photos are optional many. This is a conceptual UML model with human-readable attributes, not a physical database schema.')


make('architecture', 'Anticipated architecture: who owns each responsibility', '''
rankdir=TB;
subgraph cluster_app {
 label="Project-specific Marathon Wrapped functions"; color="#BA3143"; fontcolor="#291B1D"; fontsize=18; margin=20;
 runner [label="Runner experience\\nRecap · gallery · export", fillcolor="#D8F24B"];
 organizer [label="Organizer experience\\nResults · hero-runner management"];
 logic [label="Race calculations / recap assembly\\nTiming · pace · ranking · split insights\\nRunner-specific data only"];
 access [label="Data access and management\\nRead results / photos\\nValidate and save demo data"];
 connect [label="Optional Strava integration\\nPermission · available metrics\\nDisconnect / failure fallback"];
 runner -> logic; runner -> connect;
 organizer -> access;
 logic -> access;
}
db [label="Supabase database\\nEvent · categories · runners\\nSeeded timing / splits / photo records"];
photos [label="Supabase Storage\\nSample race-photo images"];
strava [label="Strava V3 service\\nReal integration, explicit opt-in", fillcolor="#D8F24B"];
access -> db [label="read / write"];
access -> photos [label="photo locations"];
connect -> strava [label="OAuth + metrics"];
connect -> db [label="connection / metric records"];
note [shape=plaintext, fontsize=14, label="Reused platforms/services: Next.js, Supabase, Strava and Vercel.\\nSelected in V2; this diagram does not certify completed integration.\\nTiming hardware and a real FotoYu marketplace are not connected."];
db -> note [style=invis];
''', 'Anticipated project functions include runner recap/gallery/export, organizer management, race calculations, data access and optional Strava connection. They use the selected Next.js, Supabase database/storage, Strava and Vercel platforms. This is a responsibility model, not a report of completed integrations.')

# A fixed, carefully ordered UML use-case composition avoids layout-dependent
# reordering of user goals. The DOT file remains the equivalent semantic graph.
from xml.sax.saxutils import escape
parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="1120" viewBox="0 0 1100 1120" role="img" aria-labelledby="uc-title uc-desc"><title id="uc-title">Marathon Wrapped use cases</title><desc id="uc-desc">Runner and organizer goals inside the application boundary, with Strava as an external optional service. Associations indicate participation, not sequence.</desc><rect width="1100" height="1120" fill="{CREAM}"/>']
def text(x,y,value,size=18,color=INK,anchor='start'):
    parts.append(f'<text x="{x}" y="{y}" font-family="Arial,Helvetica,sans-serif" font-size="{size}" fill="{color}" text-anchor="{anchor}">{escape(value)}</text>')
def association(x,y,a,b):
    parts.append(f'<line x1="{x}" y1="{y}" x2="{a}" y2="{b}" stroke="{RED}" stroke-width="1.5"/>')
def actor(x,y,lines):
    parts.append(f'<circle cx="{x}" cy="{y}" r="17" fill="{CREAM}" stroke="{RED}" stroke-width="2"/><path d="M{x},{y+17} v48 M{x-30},{y+36} h60 M{x},{y+65} l-25,36 M{x},{y+65} l25,36" stroke="{RED}" stroke-width="2" fill="none"/>')
    for i,l in enumerate(lines):text(x,y+130+i*25,l,18,INK,'middle')
text(40,48,'Use cases: what runners and organizers need to do',27,RED)
text(40,80,'Marathon Wrapped • SRS V3 • goals and roles, not an action sequence',16)
parts.append(f'<rect x="280" y="110" width="530" height="910" rx="8" fill="none" stroke="{RED}" stroke-width="1.5"/>')
text(305,145,'Marathon Wrapped prototype',20)
centers = [205,315,425,535,645,755,865,955]
goals=[('View my personal race recap','UR-F1 · UR-F7'),('Understand my split performance','UR-F2'),('Connect Strava for extra detail','UR-F3'),('Disconnect Strava','UR-F4'),('View my matched race photos','UR-F5'),('Export / share my recap image','UR-F6'),('View event results','UR-F8'),('Manage hero-runner demo data','UR-F9 · create / update / replace')]
# Draw connectors first, then opaque use cases to protect their labels.
for y in centers[:6]:association(150,471,310,y)
for y in centers[6:]:association(945,881,780,y)
association(945,396,780,425)
for y,(title,rid) in zip(centers,goals):
    parts.append(f'<ellipse cx="545" cy="{y}" rx="235" ry="43" fill="{CREAM}" stroke="{RED}" stroke-width="1.5"/>')
    text(545,y-3,title,18,INK,'middle'); text(545,y+22,rid,15,INK,'middle')
actor(120,435,['Runner'])
actor(975,845,['Organizer'])
actor(975,360,['Strava service','External, opt-in'])
text(40,1060,'Optional data and DNF are alternative outcomes, not extra compulsory steps.',17)
text(40,1090,'Read FS-01–FS-08 for inputs, conditions, side effects and failure paths.',17)
parts.append('</svg>')
(HERE/'use-case-diagram.svg').write_text('\n'.join(parts))
subprocess.run(['rsvg-convert', '-z', '1.5', str(HERE/'use-case-diagram.svg'), '-o', str(HERE/'use-case-diagram.png')],check=True)
print('Built 8 diagrams, editable sources and PNG copies.')
# Compact overview: preserve readable labels when embedded in the SRS.
parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="620" viewBox="0 0 1100 620" role="img" aria-labelledby="ov-title ov-desc"><title id="ov-title">Your race becomes a story worth keeping</title><desc id="ov-desc">Race results become a personal recap, then a shareable image. Strava detail and BIB-matched photos are optional. Timing and photos use sample data.</desc><defs><marker id="ov-arrow" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L0,8 L9,4 z" fill="{RED}"/></marker></defs><rect width="1100" height="620" fill="{CREAM}"/>']
text(40,50,'Your race becomes a story worth keeping',29,RED)
text(40,84,'Understand your performance, add memories, and keep a recap you can share.',18)
def ovbox(x,y,w,h,lines,fill=CREAM,color=INK):
    parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="{fill}" stroke="{RED}" stroke-width="1.5"/>')
    for i,l in enumerate(lines):text(x+20,y+34+i*28,l,18,color)
def ovarrow(x,y,a,b,dashed=False):
    parts.append(f'<path d="M{x},{y} L{a},{b}" stroke="{RED}" stroke-width="1.5" fill="none" marker-end="url(#ov-arrow)"'+(' stroke-dasharray="6 5"' if dashed else '')+'/>')
ovbox(40,140,290,150,['Your race results','Time · pace · placing','Performance per kilometer'],LIME)
ovbox(405,140,290,150,['Your personal recap','Understand race highlights','View on phone or computer'],RED,CREAM)
ovbox(770,140,290,150,['Save and share','Export a recap image','Keep your achievement'])
ovarrow(330,215,405,215);ovarrow(695,215,770,215)
ovbox(95,385,365,125,['Optional: Strava detail','Heart rate · elevation','Cadence · calories'])
ovbox(640,385,365,125,['Optional: race photos','Matched to your BIB number','Sample marketplace photos'])
ovarrow(300,385,470,290,True);ovarrow(800,385,630,290,True)
text(95,330,'With your permission',16);text(815,330,'When matches exist',16)
text(40,560,'Your recap works without Strava or photos. A DNF recap never invents a finish time or pace.',18)
text(40,594,'Prototype: Soekarno Run 2027 • 5K and 10K • Timing and photo matching are simulated.',16)
parts.append('</svg>')
(HERE/'overview.svg').write_text('\n'.join(parts))
subprocess.run(['rsvg-convert','-z','1.5',str(HERE/'overview.svg'),'-o',str(HERE/'overview.png')],check=True)
