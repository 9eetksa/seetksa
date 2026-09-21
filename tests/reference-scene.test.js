import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

// Captured from the source experience before the Pro Vision adaptation
// These baselines describe the supplied reference and must not be regenerated
// from replacement geometry or new animations to make a regression pass
const projectRoot = new URL('../', import.meta.url);
const provenance = JSON.parse(readFileSync(new URL('assets/reference-source/provenance.json', projectRoot)));
const sourceModels = JSON.parse(readFileSync(new URL('assets/reference-source/models-summary.json', projectRoot)));
const requiredModels = [
  'camera_1.glb',
  'camera_2.glb',
  'fancy_hand_2.glb',
  'glass_shards.glb',
  'human_hand_1.glb',
  'human_hand_2.glb',
  'loader_hand.glb',
  'stage2_glass-shatter.glb',
  'tunnel_new_new.glb',
];
const modelPath = (name) => `public/scenes/reference/assets/models/${name}`;

function parseGlb(path) {
  const bytes = readFileSync(new URL(path, projectRoot));
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, `${path} must be a GLB`);
  assert.equal(bytes.readUInt32LE(4), 2, `${path} must use GLB version 2`);
  assert.equal(bytes.readUInt32LE(8), bytes.length, `${path} must not be truncated`);
  let model;
  let binary;
  for (let offset = 12; offset < bytes.length;) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + length;
    assert.ok(end <= bytes.length, `${path} has a truncated chunk`);
    if (type === 0x4e4f534a) model = JSON.parse(bytes.subarray(start, end).toString('utf8'));
    if (type === 0x004e4942) binary = bytes.subarray(start, end);
    offset = end;
  }
  assert.ok(model && binary, `${path} must contain its source model and binary data`);
  return {model, binary};
}

function keyframeTimes(model, binary, accessorIndex) {
  const accessor = model.accessors[accessorIndex];
  assert.equal(accessor.type, 'SCALAR');
  assert.equal(accessor.componentType, 5126, 'Animation times use 32 bit floats');
  assert.equal(accessor.sparse, undefined, 'Source animation times use complete accessors');
  const view = model.bufferViews[accessor.bufferView];
  assert.equal(view.buffer, 0, 'Animation keyframes remain embedded');
  const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const stride = view.byteStride || 4;
  assert.ok(accessor.count > 0, 'An animation track must retain its keyframes');
  assert.ok(start + (accessor.count - 1) * stride + 4 <= binary.length, 'Keyframe bytes must be present');
  const times = Array.from({length: accessor.count}, (_, index) => binary.readFloatLE(start + index * stride));
  times.forEach((time, index) => {
    assert.ok(Number.isFinite(time), 'Keyframe times must be finite');
    if (index > 0) assert.ok(time > times[index - 1], 'Animation time must advance between keyframes');
  });
  return times;
}

test('all reference hands cameras glass and tunnel retain the captured original bytes', () => {
  assert.deepEqual(sourceModels.map(({path}) => path).sort(), requiredModels.map(modelPath).sort());
  for (const name of requiredModels) {
    const path = modelPath(name);
    const records = provenance.files.filter((file) => file.path === path);
    assert.equal(records.length, 1, `${name} must have one captured source record`);
    const source = records[0];
    assert.equal(source.sourceUrl, `https://why.zero.university/assets/models/${name}`);
    const bytes = readFileSync(new URL(path, projectRoot));
    assert.equal(bytes.length, source.bytes, `${name} source byte count changed`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), source.sha256, `${name} must remain the original model`);
  }
});

test('the original hand camera and shatter keyframes retain their source timing and channels', () => {
  for (const source of sourceModels) {
    const {model, binary} = parseGlb(source.path);
    assert.equal(model.nodes.length, source.nodes, `${source.path} source scene graph changed`);
    assert.deepEqual((model.meshes || []).map(({name}) => name), source.meshes);
    assert.deepEqual(model.cameras || [], source.cameras, `${source.path} source lens changed`);
    const animations = model.animations || [];
    assert.equal(animations.length, source.animations.length, `${source.path} lost a source animation`);
    for (let index = 0; index < animations.length; index += 1) {
      const animation = animations[index];
      const expected = source.animations[index];
      assert.equal(animation.name, expected.name);
      assert.equal(animation.channels.length, expected.channels, `${source.path} lost animated channels`);
      const tracks = animation.samplers.map((sampler) => keyframeTimes(model, binary, sampler.input));
      const timeMin = Math.min(...tracks.map((times) => times[0]));
      const timeMax = Math.max(...tracks.map((times) => times[times.length - 1]));
      // Binary values are float32 while the source metadata keeps exporter precision
      assert.ok(Math.abs(timeMin - expected.timeMin) < 1e-5, `${source.path} animation start changed`);
      assert.ok(Math.abs(timeMax - expected.timeMax) < 1e-5, `${source.path} animation end changed`);
      assert.ok(Math.abs((timeMax - timeMin) - (expected.timeMax - expected.timeMin)) < 1e-5, `${source.path} animation duration changed`);
      for (const channel of animation.channels) {
        assert.ok(model.nodes[channel.target.node], 'Animated source node must remain present');
        const sampler = animation.samplers[channel.sampler];
        assert.ok(sampler, 'Animated source channel must retain its sampler');
        const input = model.accessors[sampler.input];
        const output = model.accessors[sampler.output];
        assert.equal(output.count, input.count * (sampler.interpolation === 'CUBICSPLINE' ? 3 : 1), 'Every animation keyframe must retain its transform sample');
      }
    }
  }
});
