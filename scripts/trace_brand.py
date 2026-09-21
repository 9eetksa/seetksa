from pathlib import Path
import cv2
import numpy as np
import json

ROOT = Path(__file__).resolve().parents[1]
image = cv2.imread(str(ROOT / 'assets/brand-source/provision-reference.png'))
# Work on the source's full resolution: isolate the silver front face of the lettering.
hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
mask = np.zeros(image.shape[:2], np.uint8)
region = (hsv[:,:,1] < 115) & (hsv[:,:,2] > 116)
mask[450:749,170:692] = (region[450:749,170:692] * 255).astype(np.uint8)
mask = cv2.medianBlur(mask,5)
mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3,3),np.uint8))
mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3,3),np.uint8))
contours, hierarchy = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
parts=[]
clean=np.zeros_like(mask)
for i,c in enumerate(contours):
    if hierarchy[0][i][3] != -1 or cv2.contourArea(c) < 70: continue
    polygon=cv2.approxPolyDP(c,.7,True)[:,0,:].tolist()
    holes=[]
    child=hierarchy[0][i][2]
    while child!=-1:
        if cv2.contourArea(contours[child])>45:
            holes.append(cv2.approxPolyDP(contours[child],.65,True)[:,0,:].tolist())
        child=hierarchy[0][child][0]
    parts.append({'name':f'Lettering_{len(parts)+1:02d}','outline':polygon,'holes':holes})
    cv2.drawContours(clean,[c],-1,255,-1)
    for hole in holes: cv2.fillPoly(clean,[np.array(hole)],0)
out=ROOT/'assets/brand-source'
out.mkdir(parents=True,exist_ok=True)
(out/'lettering-contours.json').write_text(json.dumps(parts,indent=2))
preview=np.full_like(image,245)
preview[clean>0]=(70,115,30)
cv2.imwrite(str(out/'lettering-trace-preview.png'),preview[420:790,150:710])
print(json.dumps([{'name':p['name'],'points':len(p['outline']),'holes':len(p['holes'])} for p in parts]))
