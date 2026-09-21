"""Reproducible Blender model for the Pro Vision homepage aperture
Run with Blender --background --python scripts/build_hook_portal.py
The original Pro Vision logo is not modified
"""
import math
from pathlib import Path
import bpy

ROOT = Path(__file__).resolve().parents[1]
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

def material(name, color, metal, rough):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Coat Weight'].default_value = 1
    bsdf.inputs['Coat Roughness'].default_value = .09
    return mat

emerald = material('Polished emerald enamel', (.025,.37,.19), .62, .16)
pearl = material('Pearl brushed silver', (.73,.86,.74), .86, .2)
lime = material('Lime reflected edge', (.57,.82,.22), .7, .18)

# Sculpted twisted ribbon blades form a dimensional aperture around negative space
for blade in range(6):
    vertices, faces = [], []
    segments, across = 56, 8
    for u in range(segments+1):
        t = u / segments
        angle = (blade / 6 * math.tau) + t * 1.55
        envelope = math.sin(math.pi*t)**.48
        for v in range(across+1):
            side = v/across-.5
            radius = 2.05 + side * (.16 + .86*envelope)
            z = math.sin(t*math.pi*1.4)*.44 + side*math.sin(t*math.pi)*.65
            vertices.append((math.cos(angle)*radius, math.sin(angle)*radius, z))
    for u in range(segments):
        for v in range(across):
            a = u*(across+1)+v
            faces.append((a,a+1,a+across+2,a+across+1))
    mesh = bpy.data.meshes.new(f'Aperture ribbon {blade+1}')
    mesh.from_pydata(vertices, [], faces); mesh.update()
    obj = bpy.data.objects.new(f'Blade_{blade}', mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(pearl if blade%3==0 else emerald)
    for poly in mesh.polygons: poly.use_smooth = True
    solid = obj.modifiers.new('Precision thickness', 'SOLIDIFY'); solid.thickness=.065
    bevel = obj.modifiers.new('Polished edges','BEVEL'); bevel.width=.035; bevel.segments=3
    bpy.context.view_layer.objects.active=obj
    for modifier in list(obj.modifiers): bpy.ops.object.modifier_apply(modifier=modifier.name)

for radius, thickness, z in [(1.52,.022,-.14),(2.68,.016,-.25),(2.81,.012,-.3)]:
    bpy.ops.mesh.primitive_torus_add(major_segments=128,minor_segments=8,location=(0,0,z),major_radius=radius,minor_radius=thickness)
    bpy.context.object.name=f'Orbital light {radius}'
    bpy.context.object.data.materials.append(lime)
    for poly in bpy.context.object.data.polygons: poly.use_smooth=True

# glTF is Y up while the authored aperture faces Blender Z
# Keep the authored orientation via the wrapper transform in the Three scene
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / '.tools' / 'provision-hook-portal.blend'))
bpy.ops.export_scene.gltf(filepath=str(ROOT / 'public/scenes/provision-hook-portal.glb'),export_format='GLB',export_yup=False,export_animations=False)
print('Exported sculpted aperture', sum(len(o.data.polygons) for o in bpy.data.objects if o.type=='MESH'), 'faces')
