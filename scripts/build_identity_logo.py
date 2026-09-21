"""Build editable, extruded Bezier geometry directly from the identity PDF paths.
Run extraction first, then Blender --background --python scripts/build_identity_logo.py.
"""
import json
from pathlib import Path
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'brand-identity'
OUT = ROOT / 'public/brand'
data = json.loads((SOURCE / 'logo-curves.json').read_text())
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
SCALE = .01
CX, CY = (610.050903 + 1310.990723) / 2, 540

def point(p):
    return ((p[0] - CX) * SCALE, (CY - p[1]) * SCALE, 0)

def material(name, color, metallic=.15, roughness=.32):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    return mat

ivory = material('Approved white lettering and outline', (.92, .96, .94), .12)
side = material('Subtle emerald extrusion', (.008, .075, .057), .25)
parts = []
editable = bpy.data.collections.new('Original PDF Bezier masters')
bpy.context.scene.collection.children.link(editable)
editable.hide_render = True
editable.hide_viewport = True

for shape in data['shapes']:
    ribbon = 'texture' in shape
    curve = bpy.data.curves.new(shape['name'], 'CURVE')
    curve.dimensions = '2D'
    curve.resolution_u = 10
    curve.fill_mode = 'BOTH'
    curve.extrude = .001 if ribbon else .045
    curve.bevel_depth = 0 if ribbon else .003
    curve.bevel_resolution = 2
    for contour in shape['contours']:
        # Segment starts and handles are copied without smoothing or resampling.
        nodes = []
        for segment in contour:
            pts = segment['points']
            nodes.append({'co': pts[0], 'out': pts[1] if segment['kind'] == 'c' else pts[0]})
        last = contour[-1]['points'][-1]
        closed = sum(abs(a-b) for a,b in zip(last, nodes[0]['co'])) < .01
        if not closed:
            nodes.append({'co': last, 'out': last})
        spline = curve.splines.new('BEZIER')
        spline.bezier_points.add(len(nodes) - 1)
        spline.use_cyclic_u = True
        for i, node in enumerate(nodes):
            vertex = spline.bezier_points[i]
            vertex.co = point(node['co'])
            vertex.handle_left_type = 'FREE'
            vertex.handle_right_type = 'FREE'
            vertex.handle_right = point(node['out'])
            previous = contour[i-1] if i else (contour[-1] if closed else None)
            incoming = previous['points'][-2] if previous and previous['kind'] == 'c' else node['co']
            vertex.handle_left = point(incoming)
    obj = bpy.data.objects.new(shape['name'], curve)
    bpy.context.collection.objects.link(obj)
    # PDF ribbons overlap in painter order. Separate their caps in depth so
    # that overlapping gradients never compete for the same depth-buffer pixel.
    obj.location.z = .054 + int(shape['name'][-1]) * .006 if ribbon else 0
    obj['source'] = 'Identity PDF page 6; approved white variant page 7'
    obj['original_path'] = shape['name']
    mat = ivory
    if ribbon:
        mat = material(shape['name'] + ' original PDF gradient', (1, 1, 1), 0, .42)
        tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
        tex.image = bpy.data.images.load(str(SOURCE / shape['texture']['file']))
        tex.image.pack()
        mat.node_tree.links.new(tex.outputs['Color'], mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
    obj.data.materials.append(mat)
    # Preserve editable cubic paths, while exporting only one evaluated mesh per part.
    master = obj.copy()
    master.data = obj.data.copy()
    editable.objects.link(master)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target='MESH')
    obj.data.materials.append(side)
    for polygon in obj.data.polygons:
        polygon.use_smooth = abs(polygon.normal.z) < .95
        if abs(polygon.normal.z) < .65 or polygon.normal.z < -.95:
            polygon.material_index = 1
    if ribbon:
        tex = shape['texture']
        uv = obj.data.uv_layers.new(name='Original PDF coordinates')
        obj.data.uv_layers.active = uv
        uv.active_render = True
        uv_node = mat.node_tree.nodes.new('ShaderNodeUVMap')
        uv_node.uv_map = uv.name
        image_node = next(node for node in mat.node_tree.nodes if node.type == 'TEX_IMAGE')
        mat.node_tree.links.new(uv_node.outputs['UV'], image_node.inputs['Vector'])
        for loop in obj.data.loops:
            co = obj.data.vertices[loop.vertex_index].co
            x, y = co.x / SCALE + CX, CY - co.y / SCALE
            uv.data[loop.index].uv = ((x - tex['x']) / tex['width'], 1 - (y - tex['y']) / tex['height'])
    parts.append(obj)

scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 32
scene.cycles.use_denoising = True
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.resolution_percentage = 100
scene.view_settings.view_transform = 'Standard'
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.5, .5, .5, 1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value = .5
for name, location, power, size in [('Soft key', (-3, 4, 7), 450, 5), ('Soft fill', (4, -2, 5), 250, 4)]:
    light = bpy.data.lights.new(name, 'AREA')
    light.energy, light.size = power, size
    obj = bpy.data.objects.new(name, light)
    scene.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (Vector((0, 0, 0)) - obj.location).to_track_quat('-Z', 'Y').to_euler()
cam = bpy.data.cameras.new('Front camera, original proportions')
camera = bpy.data.objects.new('Front camera, original proportions', cam)
scene.collection.objects.link(camera)
camera.location = (0, 0, 15)
camera.rotation_euler = (0, 0, 0)
cam.type = 'ORTHO'
cam.ortho_scale = 7.7
scene.camera = camera
bpy.ops.object.select_all(action='DESELECT')
for obj in parts:
    obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT / 'provision-logo.glb'), export_format='GLB', use_selection=True,
                          export_apply=True, export_animations=False, export_yup=False)
facts = {'source': 'Pro Vision Idenitiy_Folder/Pro Vision Idenitiy.pdf', 'source_page': 6, 'white_variant_page': 7,
         'method': 'Original cubic Bezier paths, original clipped gradient textures, shallow extrusion',
         'mesh_count': len(parts), 'editable_curve_count': len(editable.objects),
         'vertices': sum(len(o.data.vertices) for o in parts), 'textures': 3,
         'extrusion_depth': .09, 'width': 7.0093982,
         'parts': [{'name': o.name, 'dimensions': list(o.dimensions), 'vertices': len(o.data.vertices)} for o in parts]}
(OUT / 'provision-logo-manifest.json').write_text(json.dumps(facts, indent=2))
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'provision-logo.blend'))
for name, width, height in [('provision-logo-transparent.png', 1540, 600), ('provision-logo-preview.png', 924, 360), ('provision-logo-footer.png', 360, 140)]:
    scene.render.resolution_x, scene.render.resolution_y = width, height
    scene.render.filepath = str(OUT / name)
    bpy.ops.render.render(write_still=True)
ivory.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (0, .053, .041, 1)
for name, width, height in [('provision-logo-header.png', 400, 156), ('provision-logo-ink.png', 1540, 600)]:
    scene.render.resolution_x, scene.render.resolution_y = width, height
    scene.render.filepath = str(OUT / name)
    bpy.ops.render.render(write_still=True)
print('IDENTITY_LOGO_COMPLETE', json.dumps(facts))
