"""Small transparent website renders from the Blender model, preserving downloadable masters."""
from pathlib import Path
import bpy

root = Path(__file__).resolve().parents[1]
out = root / 'public/brand'
bpy.ops.wm.open_mainfile(filepath=str(out / 'provision-logo.blend'))
scene = bpy.context.scene
scene.cycles.samples = 32
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.image_settings.compression = 100
scene.render.resolution_percentage = 100
for name, width, height in [('provision-logo-preview.png', 800, 340), ('provision-logo-footer.png', 360, 153)]:
    scene.render.resolution_x, scene.render.resolution_y = width, height
    scene.render.filepath = str(out / name)
    bpy.ops.render.render(write_still=True)
for name in ['Approved white lettering and outline']:
    bs = bpy.data.materials[name].node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value = (.008, .03, .019, 1)
    bs.inputs['Metallic'].default_value = .2
scene.render.resolution_x, scene.render.resolution_y = 400, 170
scene.render.filepath = str(out / 'provision-logo-header.png')
bpy.ops.render.render(write_still=True)
