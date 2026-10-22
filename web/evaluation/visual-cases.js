// Generated synthetic image fixtures; sharp is a development-only dependency.
export async function visualCases() {
  const {default:sharp}=await import('sharp');
  return Promise.all(Array.from({length:8},async(_,i)=> {
    const red=1+i%4,blue=1+Math.floor(i/4),code=`V${i}-K729`;
    const shapes=[];
    for(let n=0;n<red;n++) shapes.push(`<circle cx="${520+n%2*100}" cy="${150+Math.floor(n/2)*100}" r="25" fill="#d00000"/>`);
    for(let n=0;n<blue;n++) shapes.push(`<rect x="${500+n*100}" y="390" width="50" height="50" fill="#0044dd"/>`);
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="white"/><g font-family="Arial" font-size="24" fill="black"><text x="30" y="50">Monthly units</text><text x="30" y="530">Reference: ${code}</text><text x="470" y="70">Isolated shapes</text><text x="65" y="460">Jan</text><text x="185" y="460">Feb</text><text x="305" y="460">Mar</text><text x="65" y="225">20</text><text x="185" y="120">35</text><text x="305" y="270">15</text></g><g fill="#555"><rect x="60" y="240" width="60" height="200"/><rect x="180" y="135" width="60" height="305"/><rect x="300" y="285" width="60" height="155"/></g>${shapes.join('')}</svg>`;
    const bytes=await sharp(Buffer.from(svg)).png().toBuffer();
    return {id:`vision-${i}`,family:'vision',capability:'verification',signedIn:true,
      messages:[{role:'user',content:[{type:'text',text:'Use only this image. Return ONLY JSON with red_count, blue_count, jan, feb, mar, reference and profit. Count isolated shapes, not chart bars. Use null for data not shown.'},
        {type:'image_url',image_url:{url:`data:image/png;base64,${bytes.toString('base64')}`,detail:'high'}}]}],
      checks:{jsonEquals:{red_count:red,blue_count:blue,jan:20,feb:35,mar:15,reference:code,profit:null}},
      review:'Verify counting, chart reading, OCR, missing-value handling and exact JSON independently.'};
  }));
}
