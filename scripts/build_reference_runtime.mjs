/**
 * Produce the local Seet edition of the scene shown in the supplied video
 * Original geometry camera tracks gesture recognition and scene durations
 * remain in the checked in upstream bundle and are not regenerated
 * The user's later instruction replaces the offensive gesture with fingertip
 * contact and the exact logo breaking through the original glass animation
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transform, build } from 'esbuild'
import { parse } from '@babel/parser'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = resolve(root, 'assets/reference-source/main.original.js')
const outputPath = resolve(root, 'public/scenes/reference/runtime.js')
const original = await readFile(sourcePath, 'utf8')
const originalHash = createHash('sha256').update(original).digest('hex')
if (originalHash !== '847025bbd4c0ec4762028280d97dc23850bd6981671dbc67205825dbfd4106cb') {
  throw new Error('The reference source changed and requires a fresh scene and integration review')
}
let source = (await transform(original, { minify: false, loader: 'js' })).code
const audit = []
function replaceExact(before, after, count = 1) {
  const found = source.split(before).length - 1
  if (found !== count) throw new Error(`Reference source changed for ${before.slice(0, 95)} expected ${count} found ${found}`)
  source = source.split(before).join(after)
  audit.push({ target: before.slice(0, 95), replacements: found })
}
function replaceRange(start, end, replacement, expectedStarts = 1) {
  const a = source.indexOf(start)
  const b = source.indexOf(end, a + start.length)
  if (a < 0 || b < 0 || source.split(start).length - 1 !== expectedStarts) throw new Error(`Missing or ambiguous reference boundary ${start}`)
  source = source.slice(0, a) + replacement + source.slice(b)
  audit.push({ section: start, end })
}
function ast() { return parse(source, { sourceType: 'module' }).program.body }
function functionText(name) {
  const node = ast().find(node => node.type === 'FunctionDeclaration' && node.id.name === name)
  if (!node) throw new Error(`Missing upstream function ${name}`)
  return source.slice(node.start, node.end)
}
function replaceFunction(name, body) { replaceExact(functionText(name), body) }
function replaceVariable(name, value) {
  const declarations = ast().filter(node => node.type === 'VariableDeclaration').flatMap(node => node.declarations)
  const node = declarations.find(node => node.id.name === name)
  if (!node?.init) throw new Error(`Missing upstream variable ${name}`)
  replaceExact(source.slice(node.init.start, node.init.end), value)
}

// Keep the original glass bar styling while removing signup analytics sharing
// email handling account storage and all associated third party navigation
const barCss = functionText('YE')
replaceRange('var PC, FC,', 'var eD =', `var JE = false;\n${barCss}\n${localBar()}\n`)
replaceRange('Aw(), (() => {', 'var WO =', '')
replaceRange('WO && zT(async () => {', 'var tk =', '', 2)
replaceRange('WO && zT(async () => {', 'export { o as t };', '')
replaceExact('export { o as t };', '')
replaceVariable('WO', 'false')
replaceVariable('GO', 'null')
replaceFunction('JO', 'function JO() { return null; }')
replaceFunction('YO', 'function YO() {}')
replaceFunction('Ib', 'function Ib() {}')
replaceFunction('VD', 'function VD() { return { openEmail: () => pvPost("exit"), destroy() {} }; }')
replaceRange('  _handleOpenWaitlist({ gate:', '  _ensureWaitlistBar()', '  _handleOpenWaitlist() { pvPost("exit"); }\n')
replaceExact('DC(), NC(X), uO();', 'NC(X), uO();')
replaceFunction('OC', 'function OC() { return "pointer"; }')
replaceFunction('kC', 'function kC() { return "grab"; }')
replaceFunction('AC', 'function AC() { return "grabbing"; }')

// The supplied recording ends in stage 3 before the original city/signup scenes
replaceVariable('nO', '[Sx, yx, sx, Wb, Xx]')
replaceExact('let e36 = this.segments.findIndex((e37) => e37.id === `stage1`), t2 = this.segments.findIndex((e37) => e37.id === `stage5`), n2 = this._activeIndex;', 'let e36 = this.segments.findIndex((e37) => e37.id === `stage1`), t2 = this.segments.length - 1, n2 = this._activeIndex;')
replaceExact('let t2 = [`initial`, `stage2`, `stage3`, `stage4`]', 'let t2 = [`initial`, `stage2`, `stage3`]')
replaceExact('}), mk.loadStageAssets(`stage4`), oA.start()', '}), oA.start()')
replaceExact('  async _advanceToNext() {', '  async _advanceToNext() {\n    if (this._activeIndex === this.segments.length - 1) { pvPost("exit"); return; }')
// Scroll overshoot and incidental advance calls cannot skip fingertip contact
// Only the native hold timer completion releases the stage 1 boundary
replaceExact('  async _advanceToNext() {', `  async _advanceToNext() {
    if (this.segments[this._activeIndex]?.id === 'stage1' && !this.ctx._pvContactHoldComplete) {
      this._applySegmentClamp(this._activeIndex);
      this._handleHoldTrigger(this.segments[this._activeIndex], 1);
      return;
    }`)
replaceExact('r2 && (this._resetGateRipple(), this.ctx._ripplePreplayed = true), n2.onHoldComplete', 'e36.id === "stage1" && (this.ctx._pvContactHoldComplete = true), r2 && (this._resetGateRipple(), this.ctx._ripplePreplayed = true), n2.onHoldComplete')
replaceExact('if (e36.onStage1Entered && e36.onStage1Entered(),', 'if (e36._pvContactHoldComplete = false, e36.onStage1Entered && e36.onStage1Entered(),')

// Native keyboard activation reaches the existing hold handlers and timing
replaceExact('this._holdUpHandler = null, this._activeHoldAudio = null;', `this._holdUpHandler = null, this._activeHoldAudio = null;
    this.btn.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (this._holdUpHandler) this._holdUpHandler();
        return;
      }
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      if (event.repeat) return;
      if (this._holdDownHandler) this._holdDownHandler(event);
      else if (this._clickHandler) this._clickHandler();
    });
    this.btn.addEventListener('keyup', event => {
      if (event.key !== ' ') return;
      event.preventDefault();
      if (this._holdUpHandler) this._holdUpHandler(event);
    });
    this.btn.addEventListener('blur', () => { if (this._holdUpHandler) this._holdUpHandler(); });`)
replaceExact('  updateStatus(e36, t2 = {}) {', `  updateStatus(e36, t2 = {}) {
    const initial = e36 === 'ارسم دائرة';
    this.statusText.tabIndex = initial ? 0 : -1;
    if (initial) this.statusText.setAttribute('role', 'button');
    else this.statusText.removeAttribute('role');
    this.statusText.onkeydown = initial ? event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      X.arm();
      Ak.isComplete = true;
      Ak.onStageComplete && Ak.onStageComplete();
    } : null;`)
replaceExact('  hideStatus(e36) {', `  hideStatus(e36) {
    this.statusText.tabIndex = -1;
    this.statusText.removeAttribute('role');
    this.statusText.onkeydown = null;`)

// All media and WASM workers resolve to the local scene directory
replaceExact('Sg = `/`', 'Sg = `/scenes/reference/`')
source = source.replaceAll('`/assets/', '`/scenes/reference/assets/').replaceAll('`/vendor/', '`/scenes/reference/vendor/')
source = source.replaceAll('Dv(`/`)', 'Dv(`/scenes/reference/`)').replaceAll('PO(`/`)', 'PO(`/scenes/reference/`)')
source = source.replaceAll('/assets/ui/zero_icon.jpg', '/assets/brand/nav_logo.svg')

// Replace the atlas only at the existing loader boundary so every UV rectangle
// sprite anchor blur and appearance time stays under the original scene engine
replaceExact('  _loadAssetOnce(e36, t2) {', `  _loadAssetOnce(e36, t2) {
    if (["textsAtlas", "spcAtlas", "moneyShredsAtlas", "certAtlas"].includes(e36.key)) {
      this._brandAtlasPromises ||= {};
      const createCanvas = e36.key === "textsAtlas" ? createBrandTextAtlasCanvas : () => createBrandSurfaceAtlasCanvas(e36.key);
      return (this._brandAtlasPromises[e36.key] ||= createCanvas().then(canvas => {
        const texture = new dc(canvas);
        texture.colorSpace = W;
        texture.flipY = true;
        texture.generateMipmaps = true;
        texture.minFilter = b;
        texture.magFilter = v;
        if (this.renderer) texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        texture.needsUpdate = true;
        this.assets.textures[e36.key] = texture;
        this.assets.meta[e36.key] = { stretched: true };
        this._scheduleIdleUpload(texture);
        return texture;
      }));
    }`)

// Animate only the opening lake within its existing render pass and pause clock
// Keep the drawing trail in screen space and preserve the original melt masks
replaceExact('  uniform float     uLightIntensity;', '  uniform float     uLightIntensity;\n  uniform float     uWaterTime;')
replaceExact('uLightIntensity: { value: o2.LIGHT_INTENSITY }', 'uLightIntensity: { value: o2.LIGHT_INTENSITY }, uWaterTime: { value: 0 }')
replaceExact('    vec2 ratioUv = (vUv - 0.5) * uFrostCoverScale + 0.5 + uFrostShift;', `    vec2 ratioUv = (vUv - 0.5) * uFrostCoverScale + 0.5 + uFrostShift;
    vec2 waterPosition = (vUv - 0.5) * vec2(uAspect, 1.0);
    float waterWaveA = dot(waterPosition, vec2(9.0, 6.0)) + uWaterTime * 0.72;
    float waterWaveB = dot(waterPosition, vec2(-5.0, 11.0)) - uWaterTime * 0.53;
    float waterWaveC = dot(waterPosition, vec2(17.0, -8.0)) + uWaterTime * 0.91;
    vec2 waterFlow = vec2(
      sin(waterWaveA) + sin(waterWaveC) * 0.35,
      sin(waterWaveB) + cos(waterWaveC) * 0.35
    ) * 0.007 / vec2(uAspect, 1.0);
    vec2 waterUv = ratioUv + waterFlow * uFrostCoverScale;
    vec2 waterDetailUv = ratioUv * 1.35 + vec2(uWaterTime * 0.012, -uWaterTime * 0.009);`)
replaceExact('? texture2D(uFrostTexture, ratioUv)', '? texture2D(uFrostTexture, waterUv)')
replaceExact('? texture2D(uIceNormalTxt, ratioUv).rg * 2.0 - 1.0 - uNormalBias', `? mix(texture2D(uIceNormalTxt, waterUv).rg,
            texture2D(uIceNormalTxt, waterDetailUv).rg, 0.3) * 2.0 - 1.0 - uNormalBias`)
replaceExact('    vec2 disp = iceNorm * uDisplacement * iceDensity * clearMask * freezeMask * meltMask;', `    iceNorm += vec2(cos(waterWaveA), cos(waterWaveB)) * 0.12;
    vec2 disp = (iceNorm * uDisplacement * iceDensity + waterFlow * 0.35)
      * clearMask * freezeMask * meltMask;`)
replaceExact('    vec3 frostBase  = frostTex.rgb * uLightIntensity;', `    vec3 waterNormal = normalize(vec3(iceNorm * 0.75, 1.0));
    float waterGlint = pow(max(dot(waterNormal, normalize(vec3(-0.4, 0.65, 1.0))), 0.0), 18.0);
    vec3 frostBase = frostTex.rgb * uLightIntensity + vec3(0.045) * waterGlint;`)
replaceExact('    let a2 = this._trailRTs[this._trailIdx], o2 = this._trailRTs[1 - this._trailIdx], s2 = r2 && r2 > 0 ? r2 : 1 / 60;', `    let a2 = this._trailRTs[this._trailIdx], o2 = this._trailRTs[1 - this._trailIdx], s2 = r2 && r2 > 0 ? r2 : 1 / 60;
    this.material.uniforms.uWaterTime.value += Math.min(s2, 0.05);`)

// Reuse the scene idle controller for a quiet hint only while scrolling is useful
replaceExact('HO = 3e3', 'HO = 6e3')
replaceExact('  setIdleSuppressed(e36) {', `  _syncIdleAvailability() {
    const segment = oA.segments[oA._activeIndex];
    const allowed = !!(this._idleActive && pvIsReady && !pvRequestedPause && !document.hidden
      && oA.isActive && segment && !segment.autoScroll && !oA._entering && !oA._isTransitioning
      && !oA._holdShown && Gk.enabled && !Gk._held && !Gk._isAutoScrolling
      && Gk.scrollPos < (Gk._scrollClampMax ?? oA.scrollLength) - 1);
    if (allowed === this._pvIdleAllowed && segment === this._pvIdleSegment) return;
    this._pvIdleAllowed = allowed;
    this._pvIdleSegment = segment;
    if (this._idleActive) this._onScroll();
    else this._render();
  }
  setIdleSuppressed(e36) {`)
replaceExact('this._idleActive && this._idleReady && !this._idleSuppressed ? `idle`', 'this._idleActive && this._idleReady && !this._idleSuppressed && this._pvIdleAllowed ? `idle`')
replaceExact('Q.uniforms.uTime.value = t2;', 'Q.uniforms.uTime.value = t2;\n  qk._syncIdleAvailability();')
replaceExact('  showScrollIndicator() {', `  showScrollIndicator() {
    this.scrollIndicator.removeAttribute('aria-hidden');`)
replaceExact('  hideScrollIndicator(e36) {', `  hideScrollIndicator(e36) {
    this.scrollIndicator.setAttribute('aria-hidden', 'true');`)

// Palette only The hand shading keeps the original light dark and normals
// Preserve skinned vertices UVs bones skin weights gesture history and cameras
const mintShader = 'float pvHandLight = max(gl_FragColor.r, max(gl_FragColor.g, gl_FragColor.b)); gl_FragColor.rgb = vec3(0.85, 0.85, 0.85) * pvHandLight;'
replaceExact('e37.fragmentShader.replace(`#include <dithering_fragment>`, `if (uRippleIntensity > 0.001)', 'e37.fragmentShader.replace(`#include <dithering_fragment>`, `' + mintShader + '\n        if (uRippleIntensity > 0.001)')
replaceExact('    r2 && a2.normalScale.copy(r2), this.group.traverse((e37) => {', `    a2.onBeforeCompile = shader => { shader.fragmentShader = shader.fragmentShader.replace("#include <dithering_fragment>", ${JSON.stringify(mintShader)} + "\\n#include <dithering_fragment>"); };
    r2 && a2.normalScale.copy(r2), this.group.traverse((e37) => {`)
replaceExact('vec3(0.773, 1.0, 0.796)', 'vec3(0.85, 0.85, 0.85)', 4)
replaceExact('emberColor: [0.651, 1, 0.835]', 'emberColor: [0.470588, 0.921569, 0.705882]', 2)
replaceExact('charColor: [0.525, 1, 0.706]', 'charColor: [0.470588, 0.921569, 0.705882]', 2)
replaceExact('baseColor: [110, 200, 230], glowColor: [170, 235, 215]', 'baseColor: [83, 168, 154], glowColor: [166, 242, 204]')
// Grade the existing curtain/background samples to the Seet coral
// The maximum channel carries the original fabric lighting and frame detail
// Saturation masking leaves whites neutrals and all cool background colors alone
replaceExact('    vec4 sampleBgA() {', `    vec3 pvCoralBackground(vec3 sourceColor) {
        float peak = max(sourceColor.r, max(sourceColor.g, sourceColor.b));
        float redDominance = (sourceColor.r - max(sourceColor.g, sourceColor.b)) / max(peak, 0.00001);
        float coralWeight = smoothstep(0.15, 0.60, redDominance);
        vec3 coralLinear = vec3(0.439657, 0.001821, 0.001821);
        return mix(sourceColor, coralLinear * peak, coralWeight);
    }

    vec4 sampleBgA() {`)
replaceExact('if (uLinearizeA > 0.5) colorA.rgb = sRGBToLinear(colorA.rgb);', 'if (uLinearizeA > 0.5) colorA.rgb = sRGBToLinear(colorA.rgb);\n        colorA.rgb = pvCoralBackground(colorA.rgb);')
replaceExact('if (uLinearizeB > 0.5) colorB.rgb = sRGBToLinear(colorB.rgb);', 'if (uLinearizeB > 0.5) colorB.rgb = sRGBToLinear(colorB.rgb);\n        colorB.rgb = pvCoralBackground(colorB.rgb);')
replaceExact('finalRGB.g *= mix(1.0, 0.15, uRedTint);', 'finalRGB.g *= mix(1.0, 0.15615, uRedTint);')
replaceExact('finalRGB.b *= mix(1.0, 0.10, uRedTint);', 'finalRGB.b *= mix(1.0, 0.15615, uRedTint);')

// Preserve the original arm wrist camera and descending hand trajectories
// Retarget only finger rotations away from the rejected gesture
replaceExact('let n2 = this._cloneModel(e36), r2 = t2.assets.animations.fancyHand1;\n    this._setupMixer(n2, r2);', 'let n2 = this._cloneModel(e36), r2 = t2.assets.animations.fancyHand1;\n    this._setupMixer(n2, r2), pvRecordFingerPose(this, n2, r2, 13.5, 13.5);')
replaceExact('let n2 = this._cloneModel(e36), r2 = t2.assets.animations.humanHand1;\n    this._setupMixer(n2, r2)', 'let n2 = this._cloneModel(e36), r2 = t2.assets.animations.humanHand1;\n    pvRecordFingerPose(this, n2, r2, 13.5, 13.5), this._setupMixer(n2, r2)')
replaceExact('      this._applyFingerIdle(e36);', '      this._applyFingerIdle(e36), pvApplyFingerPose(this);')
replaceExact('i2.glassShards && i2.glassShards.update();', 'i2.glassShards && i2.glassShards.update(), pvUpdateContact(e36, e36._pvContactHold || 0);')
replaceRange('  _driveGateRipple(e36, t2) {', '  _resetGateRipple() {', `  _driveGateRipple(e36, t2) {
    if (!this.ctx) return;
    this.ctx._gateZoomT = 0;
    this.ctx._gateHandProgress = 0.7 + 0.02711 * Math.min(e36 / 0.3, 1);
    this.ctx._pvContactHold = e36;
  }
`)
replaceExact('e36 && ox(e36);', 'e36 && (ox(e36), Y.to(e36, { _pvContactHold: 0, duration: 0.5, ease: "power2.out" }));')
replaceExact('e36._gateHandElapsed = 0, e36._gateTextElapsed = 0;', 'e36._gateHandElapsed = 0, e36._gateTextElapsed = 0, pvCaptureContactLogo(e36);')
replaceExact('i2.handsModel.scrub(0.7 + t3 * 0.3)', 'i2.handsModel.scrub(0.7)')
replaceExact('e36.shatterPass.setShatterTextures(qb, null)', 'e36.shatterPass.setShatterTextures(e36._pvLogoSnapshot || qb, null)')
replaceExact('n3 && r3 ? e36.shatterPass.startScrub(n3, r3)', 'n3 && r3 ? (e36.shatterPass.startScrub(n3, r3), pvProjectLogoShards(e36.shatterPass))')
replaceExact('e36.shatterPass.cleanup(), e36._gateElapsed = 0', 'e36.shatterPass.cleanup(), pvDisposeLogoSnapshot(e36), e36._gateElapsed = 0')
replaceExact('e36._gateZoomT = 0, e36._gateHandProgress = null,', 'e36._gateZoomT = 0, e36._pvContactHold = 0, e36._gateHandProgress = null,')
replaceExact('vx(e36), t2.handsModel &&', 'vx(e36), pvDisposeContact(e36), t2.handsModel &&')
replaceExact('portalPlane: l2, _bgPhase: 1, textLayout: u2 };', 'portalPlane: l2, _bgPhase: 1, textLayout: u2 }, pvInstallContact(e36);')
replaceExact('Promise.all([mk.loadAsset({ type: `texture`, key: `frosting`', 'Promise.all([createContactLogoCanvas().then(canvas => { pvContactLogoCanvas = canvas; }), mk.loadAsset({ type: `texture`, key: `frosting`')
// Original shatter geometry is mapped to the exact logo snapshot at its first
// frame so the letter shapes split with those same baked fragment movements
replaceVariable('U_', '`precision mediump float; uniform sampler2D uMapA; uniform sampler2D uMapB; uniform float uBlend; varying vec2 vUv; void main() { gl_FragColor = mix(texture2D(uMapA, vUv), texture2D(uMapB, vUv), uBlend); if (gl_FragColor.a < 0.01) discard; }`')
// The opening loader hand keeps its complete original bootstrap and motion
// The approved gesture replacement is confined to the garden contact boundary

// Input may finish the loader before its final text tween has finished
replaceExact('onUpdate: () => wk.redraw()', 'onUpdate: () => wk && wk.redraw()', 2)
replaceExact('wk.dispose()', '(Y.killTweensOf(wk), wk.dispose())', 2)

// Author every changed interface label directly Do not sanitize user text
const copy = new Map([
  ['`DRAW A ZERO`', '`ارسم دائرة`'], ['`ERROR LOADING ASSETS`', '`تعذر تحميل المشهد`'],
  ['`LOADING...`', '`جاري التحميل`'], ['`Loading progress`', '`تقدم التحميل`'],
  ['`Toggle audio`', '`تشغيل الصوت أو كتمه`'], ['`SCROLL`', '`مرر للأسفل`'],
  ['`Continue to next stage`', '`اضغط مطولا أو اضغط إدخال للمتابعة`'],
  ['`TAP\nHOLD`', '`اضغط\nمطولا`'], ['`TAP\n& HOLD`', '`اضغط\nمطولا`'],
  ['`HOLD TO CONTINUE`', '`اضغط مطولا للمتابعة`'], ['`ZERO`', '`صيت`'],
  ['`Menu`', '`القائمة`'], ['`Home`', '`الرئيسية`'], ['`Manifesto`', '`الرؤية`'],
  ['`XP`', '`أثر`'], ['`degree`', '`درجة`'],
])
for (const [before, after] of copy) if (source.includes(before)) source = source.split(before).join(after)
source = source.replaceAll("'Google Sans Flex', 'Inter', sans-serif", "'IBM Plex Sans Arabic', sans-serif")
source = source.replaceAll("'Google Sans Flex', 'Google Sans Code', sans-serif", "'IBM Plex Sans Arabic', sans-serif")
source = source.replaceAll("'Google Sans Code', system-ui, sans-serif", "'IBM Plex Sans Arabic', sans-serif")
source = source.replaceAll("700 ${i2}px 'Supply Sans', monospace", "600 ${i2}px 'IBM Plex Sans Arabic', sans-serif")
replaceExact('Nk = true, Ak.setReady();', 'Nk = true, Ak.setReady(), pvReady();', 2)
replaceExact('console.error(`Fatal Error:`, e36),', 'pvPost("error", { message: "تعذر تحميل المشهد" }), console.error(`Fatal Error:`, e36),')
replaceExact('function gA() {\n  pA &&', 'function gA() {\n  if (pvRequestedPause) return;\n  pA &&')

source = `import { createBrandTextAtlasCanvas } from './brand-text.js';\nimport { createBrandSurfaceAtlasCanvas } from './brand-surfaces.js';\nimport { createContactLogoCanvas } from './brand-contact-logo.js';\n${bridge()}\n${contactMotion()}\n${source}`
const result = await build({
  stdin: { contents: source, resolveDir: dirname(outputPath), sourcefile: 'reference-local.js', loader: 'js' },
  bundle: true, format: 'esm', target: 'es2022', treeShaking: true,
  minify: false, legalComments: 'eof', external: ['./brand-text.js', './brand-surfaces.js', './brand-contact-logo.js'], write: false,
})
const output = `// Generated by scripts/build_reference_runtime.mjs\n// Original scene SHA256 ${originalHash}\n` + result.outputFiles[0].text
for (const forbidden of ['supabase.co', 'Join-Zero-Waitlist', 'Zero-University-Log-Landing', 'window.open(', 'navigator.share(', 'localStorage.', 'sessionStorage.']) {
  if (output.includes(forbidden)) throw new Error(`Unexpected foreign integration remains in runtime ${forbidden}`)
}
await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, output)
console.log(`Built local reference runtime ${output.length} bytes with ${audit.length} asserted adaptation boundaries`)

function localBar() { return `
function $E() {
  YE();
  Y.registerEase('pvOriginalNav', progress => {
    if (progress <= 0 || progress >= 1) return progress;
    let low = 0, high = 1;
    for (let i = 0; i < 22; i++) { const t = (low + high) / 2; const x = 3 * (1 - t) * (1 - t) * t * 0.625 + t * t * t; if (x < progress) low = t; else high = t; }
    const t = (low + high) / 2;
    return 3 * (1 - t) * (1 - t) * t * 0.05 + 3 * (1 - t) * t * t + t * t * t;
  });
  const mobile = window.innerWidth <= 768;
  const circle = mobile ? 44 : 48;
  const pad = mobile ? 4 : 5;
  const labelWidth = mobile ? Math.max(120, Math.round(window.innerWidth - 40 - (2 * circle + 4 * pad)) - 56) : 320;
  const width = circle * 2 + pad * 2 + labelWidth;
  const el = document.createElement('div');
  el.className = 'eg-track';
  el.style.setProperty('--eg-pad', pad + 'px');
  el.style.width = width + 'px';
  el.style.height = circle + 'px';
  const cluster = document.createElement('div');
  cluster.className = 'eg-cluster';
  cluster.style.width = width + 'px';
  cluster.style.height = circle + 'px';
  function button(className, left, size, label, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = className + ' eg-btn';
    btn.setAttribute('aria-label', label);
    btn.style.cssText = 'left:' + left + 'px;bottom:0;width:' + size + 'px;height:' + circle + 'px';
    btn.addEventListener('click', onClick);
    cluster.appendChild(btn);
    return btn;
  }
  const logo = button('eg-circle', 0, circle, 'إعادة المشهد', () => pvReplay());
  logo.innerHTML = '<span class="eg-ic eg-ic-logo"><img src="assets/brand/nav_logo.svg" alt="صيت" /></span>';
  const pill = button('eg-pill', circle + pad, labelWidth, 'ابدأ مشروعك', () => pvPost('exit'));
  pill.innerHTML = '<span class="eg-label">ابدأ مشروعك</span>';
  const menu = button('eg-menu', circle + pad * 2 + labelWidth, circle, 'المشاهد', () => toggleMenu());
  menu.innerHTML = '<span class="eg-burger" aria-hidden="true"><span class="eg-burger-bar is--top"></span><span class="eg-burger-bar is--btm"></span></span>';
  menu.setAttribute('aria-haspopup', 'menu');
  menu.setAttribute('aria-expanded', 'false');
  const area = document.createElement('div');
  area.className = 'eg-menu-area';
  area.setAttribute('aria-hidden', 'true');
  area.inert = true;
  const links = document.createElement('div');
  links.className = 'eg-menu-inner';
  links.setAttribute('role', 'menu');
  for (const [index, label] of ['الفكرة', 'الجرأة', 'الأثر'].entries()) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'eg-menu-item';
    item.setAttribute('role', 'menuitem');
    item.style.cssText = 'border:0;background:transparent;font-family:inherit;font-weight:500;cursor:pointer';
    const roll = document.createElement('span');
    roll.className = 'eg-menu-roll';
    for (let i = 0; i < 2; i++) { const line = document.createElement('span'); line.className = 'eg-menu-line' + (i ? ' eg-menu-line--dup' : ''); line.textContent = label; if (i) line.setAttribute('aria-hidden', 'true'); roll.appendChild(line); }
    const clip = document.createElement('span');
    clip.className = 'eg-menu-clip';
    clip.appendChild(roll);
    item.appendChild(clip);
    item.addEventListener('click', () => { closeMenu(); pvNavigate(index).catch(() => pvPost('error', { message: 'تعذر تحميل المشهد' })); });
    links.appendChild(item);
  }
  area.appendChild(links);
  el.appendChild(area);
  el.appendChild(cluster);
  document.body.appendChild(el);
  let open = false;
  let navTimeline = null;
  const items = [...links.children];
  const bars = menu.querySelectorAll('.eg-burger-bar');
  const extraWidth = mobile ? 56 : 104;
  function toggleMenu() {
    if (open) { closeMenu(); return; }
    open = true;
    menu.setAttribute('aria-expanded', 'true');
    area.setAttribute('aria-hidden', 'false');
    area.inert = false;
    document.addEventListener('pointerdown', outside, true);
    el.classList.add('eg-menu-open');
    if (navTimeline) navTimeline.kill();
    navTimeline = Y.timeline();
    navTimeline.to(el, { width: width + extraWidth, height: circle + links.scrollHeight, duration: 0.65, ease: 'pvOriginalNav' }, 0)
      .to(cluster, { width: width + extraWidth, duration: 0.65, ease: 'pvOriginalNav' }, 0)
      .to(pill, { width: labelWidth + extraWidth, duration: 0.65, ease: 'pvOriginalNav' }, 0)
      .to(menu, { x: extraWidth, duration: 0.65, ease: 'pvOriginalNav' }, 0)
      .to(bars[0], { y: 3.3, rotation: 45, duration: 0.4, ease: 'back.out(2)' }, 0.05)
      .to(bars[1], { y: -3.3, rotation: -45, duration: 0.4, ease: 'back.out(2)' }, 0.05)
      .set(area, { autoAlpha: 1 }, 0.1)
      .fromTo(items, { autoAlpha: 0, yPercent: 100 }, { autoAlpha: 1, yPercent: 0, duration: 0.6, stagger: 0.03 }, 0.1);
  }
  function closeMenu() {
    if (!open) return;
    open = false;
    menu.setAttribute('aria-expanded', 'false');
    area.setAttribute('aria-hidden', 'true');
    area.inert = true;
    document.removeEventListener('pointerdown', outside, true);
    el.classList.remove('eg-menu-open');
    if (navTimeline) navTimeline.kill();
    navTimeline = Y.timeline();
    navTimeline.to(items, { autoAlpha: 0, yPercent: 10, duration: 0.25, stagger: { each: 0.01, from: 'end' } })
      .to(el, { width, height: circle, duration: 0.45, ease: 'power3.inOut' }, '<')
      .to(cluster, { width, duration: 0.45, ease: 'power3.inOut' }, '<')
      .to(pill, { width: labelWidth, duration: 0.45, ease: 'power3.inOut' }, '<')
      .to(menu, { x: 0, duration: 0.45, ease: 'power3.inOut' }, '<')
      .to(bars, { y: 0, rotation: 0, duration: 0.3, ease: 'power3.in' }, '<')
      .set(area, { autoAlpha: 0 });
  }
  function outside(event) { if (!el.contains(event.target)) closeMenu(); }
  el.addEventListener('keydown', event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); closeMenu(); menu.focus(); }
    else if (open && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const index = items.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next].focus();
    } else if (!open && event.target === menu && event.key === 'ArrowUp') { event.preventDefault(); toggleMenu(); items[0].focus(); }
  });
  function hide(duration = 0.25) { closeMenu(); Y.killTweensOf(el, 'opacity,y'); Y.to(el, { opacity: 0, y: 40, duration, ease: 'power2.in', onComplete: () => el.style.pointerEvents = 'none' }); }
  function show(duration = 0.35) { Y.killTweensOf(el, 'opacity,y'); el.style.pointerEvents = 'auto'; Y.to(el, { opacity: 1, y: 0, duration, ease: 'power2.out' }); }
  return { el, hide, show, collapse: closeMenu, setOnEmail() {}, setOnBack() {}, destroy() { document.removeEventListener('pointerdown', outside, true); if (navTimeline) navTimeline.kill(); Y.killTweensOf(el); el.remove(); } };
}` }

function bridge() { return `
let pvRequestedPause = new URLSearchParams(window.location.search).get('paused') === '1';
let pvAppliedPause = false;
let pvIsReady = false;
let pvResumeScroll = false;
let pvVideos = [];
let pvClockTime = 0;
function pvPost(type, extra = {}) {
  if (window.parent !== window) window.parent.postMessage({ namespace: 'pv-reference', type, ...extra }, window.location.origin);
}
function pvReplay() {
  if (window.parent !== window) pvPost('replay');
  else window.location.reload();
}
function pvReady() {
  if (pvIsReady) return;
  pvIsReady = true;
  pvPost('ready');
  if (pvRequestedPause) pvSetPaused(true);
  else if (document.hidden) hA();
}
function pvSetPaused(paused) {
  pvRequestedPause = paused;
  if (pvIsReady) qk._syncIdleAvailability();
  document.documentElement.classList.toggle('pv-scene-paused', paused);
  if (!pvIsReady || pvAppliedPause === paused) return;
  pvAppliedPause = paused;
  if (paused) {
    pvResumeScroll = !!Gk.enabled;
    pvClockTime = sA.elapsedTime;
    if (pk.nextStageButton._holdUpHandler) pk.nextStageButton._holdUpHandler();
    Xk();
    Gk.disable();
    Y.globalTimeline.pause();
    pvVideos = [...document.querySelectorAll('video')].filter(video => !video.paused);
    for (const video of pvVideos) video.pause();
    hA();
  } else {
    if (pvResumeScroll) Gk.enable();
    sA.getDelta();
    sA.elapsedTime = pvClockTime;
    Y.globalTimeline.resume();
    for (const video of pvVideos) video.play().catch(() => {});
    pvVideos = [];
    if (!document.hidden) gA();
  }
}
async function pvNavigate(index) {
  if (!pvIsReady || pvRequestedPause || !Number.isInteger(index) || index < 0 || index > 2) return;
  if (!oA.isActive) {
    Ak.isComplete = true;
    Sk.onCircleComplete();
    Ck && Ck.exit();
    Tk && Tk.hide();
    if (wk) { Y.killTweensOf(wk); wk.dispose(); wk = null; document.body.classList.remove('webgl-loader-overlay'); }
    qk.unpin('drawZero');
    vk ||= new Y_(uk, nk, rk);
    if (!$.glassShardPass) { hk.insertPass(vk, 2); $.glassShardPass = vk; }
    bk ||= new G_(uk, nk, rk);
    if (!$.shatterPass) { hk.addPass(bk); $.shatterPass = bk; }
    await oA.skipTo('stage' + (index + 1));
    qk.activate(Gk);
    iA();
    return;
  }
  await oA.navigateToSegment('stage' + (index + 1));
}
window.addEventListener('message', event => {
  if (event.source !== window.parent || event.origin !== window.location.origin) return;
  const message = event.data;
  if (!message || message.namespace !== 'pv-reference') return;
  if (message.type === 'pause' && typeof message.paused === 'boolean') pvSetPaused(message.paused);
  else if (message.type === 'replay') window.location.reload();
  else if (message.type === 'stage') pvNavigate(message.index).catch(() => pvPost('error', { message: 'تعذر تحميل المشهد' }));
});
for (const type of ['pointerdown', 'pointermove', 'wheel', 'touchstart', 'touchmove', 'keydown']) {
  window.addEventListener(type, event => {
    if (type === 'keydown' && event.key === 'Tab') return;
    if (pvIsReady && !pvRequestedPause && type !== 'pointermove' && qk._idleActive) qk._onScroll();
    if (pvRequestedPause) { if (event.cancelable) event.preventDefault(); event.stopImmediatePropagation(); }
  }, { capture: true, passive: false });
}
window.addEventListener('error', () => pvPost('error', { message: 'تعذر عرض المشهد' }));
window.addEventListener('unhandledrejection', () => pvPost('error', { message: 'تعذر تحميل المشهد' }));
document.addEventListener('play', event => {
  if (!pvAppliedPause || event.target.tagName !== 'VIDEO') return;
  if (!pvVideos.includes(event.target)) pvVideos.push(event.target);
  event.target.pause();
}, true);
window.addEventListener('keydown', event => {
  if (pvRequestedPause || !pvIsReady || event.altKey || event.ctrlKey || event.metaKey || event.target.closest('button,a,input,textarea,select')) return;
  if (!oA.isActive && event.key === 'Enter') {
    event.preventDefault();
    X.arm();
    Ak.isComplete = true;
    Ak.onStageComplete && Ak.onStageComplete();
    return;
  }
  if (!Gk.enabled || Gk._isAutoScrolling || Gk._held) return;
  const step = ({ ArrowDown: 80, ArrowUp: -80, PageDown: innerHeight * 0.7, PageUp: -innerHeight * 0.7, ' ': innerHeight * (event.shiftKey ? -0.7 : 0.7) })[event.key];
  if (step === undefined) return;
  event.preventDefault();
  Gk.targetScrollPos = Math.min(Gk._scrollClampMax ?? oA.scrollLength, Math.max(Gk._scrollClampMin ?? 0, Gk.targetScrollPos + step));
});
` }

function contactMotion() { return `
// Only the digit rotations are constrained Original meshes bone translations
// arm and wrist rotations and camera tracks continue under the source mixer
let pvContactLogoCanvas = null;
function pvBoneKey(name) { return name.toLowerCase().replace(/[^a-z0-9]/g, ''); }
function pvRecordFingerPose(model, root, clips, sampleTime, applyAfter) {
  const bones = new Map();
  root.traverse(node => {
    if (node.isBone && /^def(f(index|middle|ring|pinky)|thumb)0[123]l$/.test(pvBoneKey(node.name))) bones.set(pvBoneKey(node.name), node);
  });
  model._pvFingerPoses ||= [];
  for (const clip of clips || []) for (const track of clip.tracks) {
    if (!track.name.endsWith('.quaternion')) continue;
    const bone = bones.get(pvBoneKey(track.name.slice(0, -11)));
    if (!bone) continue;
    const sampled = track.createInterpolant().evaluate(sampleTime);
    model._pvFingerPoses.push({ bone, rotation: new Ct().fromArray(sampled).normalize(), applyAfter });
  }
}
function pvApplyFingerPose(model) {
  const time = model._scrubProgress * model.duration;
  for (const pose of model._pvFingerPoses || []) if (time >= pose.applyAfter) pose.bone.quaternion.copy(pose.rotation);
}
function pvFindIndexTip(root) {
  let tip = null;
  root.traverse(node => { if (node.isBone && pvBoneKey(node.name) === 'deffindex03l') tip = node; });
  return tip;
}
function pvInstallContact(ctx) {
  const parts = ctx.components;
  // The former portal is not part of the approved contact sequence
  if (parts.portalPlane) parts.portalPlane.visible = false;
  const model = parts.handsModel;
  const greenRoot = model.group.children.find(root => root.getObjectByName('GreenHand'));
  const humanRoot = model.group.children.find(root => root.getObjectByName('HumanHand'));
  if (!greenRoot || !humanRoot || !pvContactLogoCanvas) return;
  const greenTip = pvFindIndexTip(greenRoot), humanTip = pvFindIndexTip(humanRoot);
  if (!greenTip || !humanTip) return;
  const texture = new dc(pvContactLogoCanvas);
  texture.colorSpace = W;
  texture.flipY = true;
  texture.minFilter = b;
  texture.magFilter = v;
  texture.needsUpdate = true;
  const material = new Gn({ map: texture, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false, side: 2 });
  const logo = new Cr(new Zr(1, 1), material);
  logo.frustumCulled = false;
  logo.renderOrder = 10;
  logo.visible = false;
  ctx.scene.add(logo);
  parts.pvContact = {
    logo, texture, greenRoot, humanRoot, greenTip, humanTip,
    greenOffset: new K(), humanOffset: new K(),
    greenPoint: new K(), humanPoint: new K(), midpoint: new K(),
    greenLocalTip: new K(-0.00004826, 0.03191857, -0.00170226),
    humanLocalTip: new K(-0.00005058, 0.03193158, -0.00173700),
    aspect: pvContactLogoCanvas.width / pvContactLogoCanvas.height
  };
}
function pvUpdateContact(ctx, hold) {
  const contact = ctx.components.pvContact;
  if (!contact) return;
  const { greenRoot, humanRoot, greenTip, humanTip, greenOffset, humanOffset, greenPoint, humanPoint, midpoint, logo } = contact;
  greenRoot.position.sub(greenOffset);
  humanRoot.position.sub(humanOffset);
  greenOffset.set(0, 0, 0);
  humanOffset.set(0, 0, 0);
  ctx.components.handsModel.group.updateWorldMatrix(true, true);
  greenPoint.copy(contact.greenLocalTip).applyMatrix4(greenTip.matrixWorld);
  humanPoint.copy(contact.humanLocalTip).applyMatrix4(humanTip.matrixWorld);
  midpoint.copy(greenPoint).add(humanPoint).multiplyScalar(0.5);
  const phase = hv(hold, 0.04, 0.34);
  const ease = phase * phase * (3 - 2 * phase);
  // Root coordinate conversion keeps this correction correct if a parent moves
  greenOffset.copy(midpoint).sub(greenPoint).multiplyScalar(ease);
  humanOffset.copy(midpoint).sub(humanPoint).multiplyScalar(ease);
  const greenOrigin = greenRoot.parent.worldToLocal(greenPoint.clone());
  const humanOrigin = humanRoot.parent.worldToLocal(humanPoint.clone());
  greenOffset.copy(greenRoot.parent.worldToLocal(greenPoint.clone().add(greenOffset))).sub(greenOrigin);
  humanOffset.copy(humanRoot.parent.worldToLocal(humanPoint.clone().add(humanOffset))).sub(humanOrigin);
  greenRoot.position.add(greenOffset);
  humanRoot.position.add(humanOffset);
  greenRoot.updateWorldMatrix(false, true);
  humanRoot.updateWorldMatrix(false, true);
  const reveal = hv(hold, 0.34, 0.64);
  logo.position.copy(midpoint);
  logo.quaternion.copy(ctx.camera.quaternion);
  const distance = ctx.camera.position.distanceTo(midpoint);
  const worldHeight = 2 * distance * Math.tan(ctx.camera.fov * Math.PI / 360);
  const width = worldHeight * Math.min(ctx.camera.aspect, 1.6) * 0.3 * (0.7 + 0.3 * reveal);
  logo.scale.set(width, width / contact.aspect, 1);
  logo.material.opacity = reveal;
  logo.visible = reveal > 0;
}
function pvCaptureContactLogo(ctx) {
  pvDisposeLogoSnapshot(ctx);
  const contact = ctx.components.pvContact;
  if (!contact) return;
  pvUpdateContact(ctx, 1);
  const canvas = document.createElement('canvas');
  canvas.width = Math.min(2048, Math.max(512, ctx._vw));
  canvas.height = Math.max(1, Math.round(canvas.width * ctx._vh / ctx._vw));
  const painter = canvas.getContext('2d');
  const logo = contact.logo;
  logo.updateWorldMatrix(true, false);
  ctx.camera.updateMatrixWorld(true);
  const topLeft = new K(-0.5, 0.5, 0).applyMatrix4(logo.matrixWorld).project(ctx.camera);
  const bottomRight = new K(0.5, -0.5, 0).applyMatrix4(logo.matrixWorld).project(ctx.camera);
  const left = (topLeft.x + 1) * 0.5 * canvas.width;
  const top = (1 - topLeft.y) * 0.5 * canvas.height;
  const width = (bottomRight.x - topLeft.x) * 0.5 * canvas.width;
  const height = (topLeft.y - bottomRight.y) * 0.5 * canvas.height;
  painter.drawImage(pvContactLogoCanvas, left, top, width, height);
  const texture = new dc(canvas);
  texture.colorSpace = W;
  texture.flipY = true;
  texture.needsUpdate = true;
  ctx._pvLogoSnapshot = texture;
}
function pvProjectLogoShards(pass) {
  if (!pass._model || !pass._shardCamera) return;
  pass.scrub(0);
  pass._mixer?.update(0);
  pass._model.updateWorldMatrix(true, true);
  pass._shardCamera.updateMatrixWorld(true);
  const point = new K();
  pass._model.traverse(mesh => {
    if (!mesh.isMesh || !mesh.geometry?.attributes.position) return;
    const geometry = mesh.geometry.clone();
    const position = geometry.attributes.position;
    const uv = new Float32Array(position.count * 2);
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld).project(pass._shardCamera);
      uv[i * 2] = (point.x + 1) * 0.5;
      uv[i * 2 + 1] = (point.y + 1) * 0.5;
    }
    geometry.setAttribute('uv', new Jn(uv, 2));
    mesh.geometry = geometry;
  });
}
function pvDisposeContact(ctx) {
  const contact = ctx.components.pvContact;
  if (!contact) return;
  contact.logo.removeFromParent();
  contact.logo.geometry.dispose();
  contact.logo.material.dispose();
  contact.texture.dispose();
  delete ctx.components.pvContact;
}
function pvDisposeLogoSnapshot(ctx) {
  if (ctx._pvLogoSnapshot) ctx._pvLogoSnapshot.dispose();
  delete ctx._pvLogoSnapshot;
}
` }
