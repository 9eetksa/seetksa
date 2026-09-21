"""LEGACY raster reconstruction, superseded by scripts/build_identity_logo.py.
Reconstruct the provided lettering and emblem as editable Blender geometry.
Run: blender --background --python scripts/build_logo_blender.py
No image planes or source-image textures are used in the final model.
"""
import bpy, json, math
from pathlib import Path
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'public/brand'
OUT.mkdir(exist_ok=True,parents=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

def material(name,color,metallic,roughness):
    mat=bpy.data.materials.new(name);mat.use_nodes=True
    bs=mat.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value=(*color,1)
    bs.inputs['Metallic'].default_value=metallic
    bs.inputs['Roughness'].default_value=roughness
    bs.inputs['Coat Weight'].default_value=.38
    return mat
silver=material('Brushed platinum lettering',(.73,.82,.77),.82,.22)
rim=material('Polished platinum edges',(.86,.94,.9),.88,.16)
emerald=material('Provision emerald enamel',(.015,.42,.23),.65,.2)
deep=material('Deep emerald recessed surfaces',(.003,.07,.047),.52,.23)
jade=material('Mint light-catching ribbon',(.045,.64,.39),.6,.19)
silver_side=material('Platinum side walls',(.085,.145,.12),.8,.24)
green_side=material('Emerald side walls',(.003,.055,.028),.7,.2)
parts=[]
SCALE=.01
def point(p):return ((p[0]-620)*SCALE,(600-p[1])*SCALE)
def smooth(poly,iterations=2):
    for _ in range(iterations):
        result=[]
        for i,a in enumerate(poly):
            b=poly[(i+1)%len(poly)]
            result.extend([(a[0]*.75+b[0]*.25,a[1]*.75+b[1]*.25),(a[0]*.25+b[0]*.75,a[1]*.25+b[1]*.75)])
        poly=result
    return poly
def area(poly):return sum(a[0]*poly[(i+1)%len(poly)][1]-poly[(i+1)%len(poly)][0]*a[1] for i,a in enumerate(poly))/2
def shape(name,outline,holes=(),mat=silver,depth=.08,z=0,bevel=.018,smoothing=2):
    curve=bpy.data.curves.new(name,'CURVE');curve.dimensions='2D';curve.resolution_u=16
    curve.fill_mode='BOTH';curve.extrude=depth;curve.bevel_depth=bevel;curve.bevel_resolution=3
    for index,poly in enumerate([outline,*holes]):
        poly=[point(p) for p in smooth(poly,smoothing)]
        if (area(poly)>0)!=(index==0):poly.reverse()
        spline=curve.splines.new('POLY');spline.points.add(len(poly)-1)
        for v,(x,y) in zip(spline.points,poly):v.co=(x,y,0,1)
        spline.use_cyclic_u=True
    obj=bpy.data.objects.new(name,curve);bpy.context.collection.objects.link(obj);obj.location.z=z;obj.data.materials.append(mat)
    parts.append(obj);return obj

letters=json.loads((ROOT/'assets/brand-source/lettering-contours.json').read_text())
for item in letters:
    shape(item['name'],item['outline'],item['holes'],silver,depth=.12,bevel=.022)

# Reference coordinates are traced from the supplied emblem crop at (695,415).
def globalize(points):return [(x+695,y+415) for x,y in points]
outer=[(124,18),(269,18),(289,22),(304,36),(371,154),(374,177),(369,194),(303,314),(287,332),(268,338),(122,338),(104,333),(88,315),(20,200),(15,180),(20,158),(86,45),(102,26)]
inner=[(125,29),(268,29),(286,35),(295,46),(360,159),(364,177),(357,195),(294,307),(282,320),(265,325),(125,325),(111,320),(99,305),(31,194),(27,179),(32,163),(97,53),(109,36)]
triangle=[(117,177),(227,113),(227,246)]
shape('Emblem_emerald_body',globalize(outer),[globalize(triangle)],emerald,.11,z=0,bevel=.025,smoothing=2)
shape('Emblem_platinum_outer_rim',globalize(outer),[globalize(inner)],rim,.027,z=.12,bevel=.012,smoothing=2)

# Three curved inset faces convey the interlocking ribbon structure of the emblem.
upper=[(113,44),(169,43),(193,48),(211,66),(220,86),(221,105),(89,190),(68,211),(58,229),(56,247),(39,216),(31,192),(33,168),(96,60)]
right=[(194,34),(265,35),(280,43),(291,58),(354,165),(357,181),(350,199),(311,267),(292,281),(270,281),(246,272),(236,262),(237,103),(231,75),(220,53)]
bottom=[(72,239),(83,217),(102,198),(224,272),(250,286),(270,290),(292,284),(310,273),(285,312),(266,319),(126,319),(110,312)]
shape('Emblem_upper_recess',globalize(upper),mat=deep,depth=.008,z=.155,bevel=.011)
shape('Emblem_right_ribbon',globalize(right),mat=emerald,depth=.012,z=.162,bevel=.015)
shape('Emblem_lower_ribbon',globalize(bottom),mat=jade,depth=.011,z=.157,bevel=.013)
tri_outer=[(108,177),(234,103),(234,255)]
tri_inner=[(130,177),(222,124),(222,233)]
shape('Emblem_platinum_triangle',globalize(tri_outer),[globalize(tri_inner)],rim,.024,z=.183,bevel=.008,smoothing=0)

# Keep independent editable geometry objects in the Blender project.
collection=bpy.data.collections.new('Provision logo geometry');bpy.context.scene.collection.children.link(collection)
for obj in parts:
    for col in list(obj.users_collection):col.objects.unlink(obj)
    collection.objects.link(obj)

scene=bpy.context.scene
scene.render.engine='CYCLES';scene.cycles.samples=48
scene.render.film_transparent=True
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
scene.render.resolution_x=1600;scene.render.resolution_y=680;scene.render.resolution_percentage=100
scene.world.color=(.25,.25,.25)
scene.view_settings.view_transform='AgX'
def light(name,loc,power,size,color):
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size;data.color=color
    obj=bpy.data.objects.new(name,data);scene.collection.objects.link(obj);obj.location=loc;obj.rotation_euler=(Vector((0,0,0))-obj.location).to_track_quat('-Z','Y').to_euler()
light('Large softbox',(-3,4,6),650,5,(.88,1,.95))
light('Right rim',(5,2,3),850,3,(.42,1,.73))
light('Front strip',(-1,-3,5),450,4,(1,1,1))
camdata=bpy.data.cameras.new('Logo camera');cam=bpy.data.objects.new('Logo camera',camdata);scene.collection.objects.link(cam)
cam.location=(-.1,.1,15);cam.rotation_euler=(0,0,0)
camdata.type='ORTHO';camdata.ortho_scale=9.7;scene.camera=cam
# Export real mesh geometry only: curves are evaluated with their extrusion/bevels.
bpy.ops.object.select_all(action='DESELECT')
for obj in parts:obj.select_set(True)
bpy.context.view_layer.objects.active=parts[0]
bpy.ops.object.convert(target='MESH')
meshes=list(bpy.context.selected_objects)
for obj in meshes:
    obj.data.materials.append(silver_side if obj.name.startswith('Lettering') or 'platinum' in obj.name else green_side)
    for poly in obj.data.polygons:
        poly.use_smooth=True
        if abs(poly.normal.z)<.65:poly.material_index=1
    mod=obj.modifiers.new('Weighted bevel normals','WEIGHTED_NORMAL');mod.keep_sharp=True
bpy.ops.export_scene.gltf(filepath=str(OUT/'provision-logo.glb'),export_format='GLB',use_selection=True,export_apply=True,export_animations=False,export_yup=False)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'provision-logo.blend'))
facts={'mesh_count':len(meshes),'vertices':sum(len(o.data.vertices) for o in meshes),'materials':len(bpy.data.materials),'image_textures':sum(1 for m in bpy.data.materials if m.use_nodes for n in m.node_tree.nodes if n.type=='TEX_IMAGE'),'parts':[{'name':o.name,'dimensions':list(o.dimensions),'vertices':len(o.data.vertices)} for o in meshes]}
(OUT/'provision-logo-manifest.json').write_text(json.dumps(facts,indent=2))
scene.render.filepath=str(OUT/'provision-logo-transparent.png')
bpy.ops.render.render(write_still=True)
# An ink version for white website surfaces, using the same geometry and transparent film.
for mat in (silver,rim):
    bs=mat.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value=(.008,.03,.019,1)
    bs.inputs['Metallic'].default_value=.2
scene.render.filepath=str(OUT/'provision-logo-ink.png')
bpy.ops.render.render(write_still=True)
print('PROVISION_MODEL_COMPLETE',json.dumps(facts))
