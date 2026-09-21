// Original sprite regions and reveal timing are preserved by the scene runtime
// Only the authored copy and the identity typography change
export const brandTextSlots = [
  {rect:[0,0,775.26,371.64], lines:['كل أثر','يبدأ بفكرة'], ink:'#101011'},
  {rect:[1703.34,0,557.46,341.94], rotated:true, lines:['نمنح','الخيال'], ink:'#101011'},
  {rect:[0,558.45,257.05,185.82], lines:['شكلا'], ink:'#101011'},
  {rect:[1388.64,0,557.46,314.15], rotated:true, lines:['يبقى'], ink:'#101011'},
  {rect:[257.75,558.45,247.06,165.84], lines:['بجرأة'], ink:'#ffffff'},
  {rect:[1092.93,558.45,945.23,371.64], lines:['نكسر','المألوف'], ink:'#ffffff'},
  {rect:[0,371.64,365.21,186.82], lines:['من أول','فكرة'], ink:'#ffffff'},
  {rect:[505.51,604.41,594.62,355.65], lines:['إلى أثر','يبقى'], ink:'#ffffff'},
  {rect:[363.64,371.64,337.74,186.82], lines:['رؤيتك'], ink:'#ffffff'},
  {rect:[0,1023,482.83,168.84], lines:['وإبداعنا'], ink:'#ffffff'},
  {rect:[0,744.27,472.68,278.73], lines:['يصنعان','الفرق'], ink:'#ffffff'},
  {rect:[775.24,0,521.92,325.68], lines:['فكرة','تستحق'], ink:'#ffffff'},
  {rect:[771,1542,667,221], lines:['أن ترى النور'], ink:'#ffffff'},
  {rect:[700.32,371.64,331.52,232.77], lines:['وهذا','سبب'], ink:'#ffffff'},
  {rect:[1030.99,325.68,334.61,232.77], lines:['وجود','صيت'], ink:'#ffffff'},
];

export async function createBrandTextAtlasCanvas() {
  await document.fonts.load('600 100px "IBM Plex Sans Arabic"', 'صيت');
  const atlas = document.createElement('canvas');
  atlas.width = atlas.height = 3072;
  const context = atlas.getContext('2d');
  for (const {rect:[x,y,width,height], rotated, lines, ink} of brandTextSlots) {
    const tile = document.createElement('canvas');
    tile.width = Math.round(width * 1.5);
    tile.height = Math.round(height * 1.5);
    const pen = tile.getContext('2d');
    let size = tile.height / (lines.length * 1.32 + .2);
    pen.font = `600 ${size}px "IBM Plex Sans Arabic"`;
    const widest = Math.max(...lines.map(line => pen.measureText(line).width));
    size *= Math.min(1, tile.width * .94 / widest);
    pen.font = `600 ${size}px "IBM Plex Sans Arabic"`;
    pen.direction = 'rtl';
    pen.textAlign = 'center';
    pen.textBaseline = 'middle';
    pen.fillStyle = ink;
    lines.forEach((line,index) => pen.fillText(line,tile.width / 2,
      tile.height / 2 + (index - (lines.length - 1) / 2) * size * 1.32));
    context.save();
    context.translate(x * 1.5, y * 1.5);
    if (rotated) {
      // Shader samples (v, 1-u) for the two original vertically packed sprites
      context.translate(tile.height, 0);
      context.rotate(Math.PI / 2);
    }
    context.drawImage(tile,0,0);
    context.restore();
  }
  return atlas;
}
