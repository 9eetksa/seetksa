// Rasterize the supplied vector artwork without changing its shapes or lettering
let pendingLogo

export function createContactLogoCanvas() {
  pendingLogo ??= new Promise((resolve, reject) => {
    const artwork = new Image()
    artwork.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = 2048
      canvas.height = Math.round(canvas.width * artwork.naturalHeight / artwork.naturalWidth)
      const context = canvas.getContext('2d')
      if (!context) {
        reject(new Error('تعذر تجهيز شعار صيت'))
        return
      }
      context.drawImage(artwork, 0, 0, canvas.width, canvas.height)
      resolve(canvas)
    }
    artwork.onerror = () => reject(new Error('تعذر تحميل شعار صيت'))
    artwork.src = '/brand/seet-logo-dark.svg'
  }).catch((error) => {
    pendingLogo = undefined
    throw error
  })
  return pendingLogo
}
