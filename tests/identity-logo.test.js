import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = JSON.parse(readFileSync(new URL('../brand-identity/logo-curves.json', import.meta.url)));
const bytes = readFileSync(new URL('../public/brand/provision-logo.glb', import.meta.url));
const model = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());

test('GLB contains each original identity shape once, without editable backup copies', () => {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const roots = model.scenes[model.scene].nodes.map(index => model.nodes[index]);
  assert.deepEqual(roots.map(node => node.name).sort(), source.shapes.map(shape => shape.name).sort());
  assert.equal(new Set(roots.map(node => node.mesh)).size, source.shapes.length);
  assert.ok(roots.every(node => !node.children));
});

test('overlapping ribbon surfaces retain PDF painter order with distinct depths', () => {
  const depths = source.shapes.filter(shape => shape.texture).map(shape => {
    const node = model.nodes.find(node => node.name === shape.name);
    const mesh = model.meshes[node.mesh];
    const z = node.translation?.[2] ?? 0;
    return {min: Math.min(...mesh.primitives.map(p => model.accessors[p.attributes.POSITION].min[2])) + z,
      max: Math.max(...mesh.primitives.map(p => model.accessors[p.attributes.POSITION].max[2])) + z};
  });
  const outline = model.nodes.find(node => node.name === 'Emblem_outline');
  let previousTop = Math.max(...model.meshes[outline.mesh].primitives.map(p => model.accessors[p.attributes.POSITION].max[2]));
  for (const depth of depths) {
    assert.ok(depth.min > previousTop, 'Overlapping PDF surfaces must not be coplanar');
    previousTop = depth.max;
  }
});

test('original gradient textures and their UV coordinates are embedded for offline loading', () => {
  assert.equal(model.images.length, source.shapes.filter(shape => shape.texture).length);
  assert.ok(model.images.every(image => Number.isInteger(image.bufferView) && !image.uri));
  for (const mesh of model.meshes) {
    for (const primitive of mesh.primitives) {
      const texture = model.materials[primitive.material].pbrMetallicRoughness?.baseColorTexture;
      if (texture) assert.ok(Number.isInteger(primitive.attributes[`TEXCOORD_${texture.texCoord ?? 0}`]));
    }
  }
});
