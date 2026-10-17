import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('every rich type renders through actual Markdown with common model fence variants', async () => {
  const server = await createServer({server:{middlewareMode:true},appType:'custom'});
  try {
    const {Rendered, PresentationContext} = await server.ssrLoadModule('/src/components/blocks/Blocks.jsx');
    const render = (content, props = {}, presentation = 'adaptive') => renderToStaticMarkup(React.createElement(PresentationContext.Provider, {value:presentation}, React.createElement(Rendered, {content,sources:[],onOpen(){},...props})));
    const samples = [
      ...['overview','widgets','integrations'].map(type => ({type,title:'Supplied figures',items:[{label:'Hotel',value:'$480'},{label:'Total',value:'$715'}]})),
      {type:'steps',items:['Gather notes','Check names']},
      {type:'graph',nodes:[{id:'a',label:'Browser'},{id:'b',label:'Server'}],edges:[{from:'a',to:'b'}]},
      {type:'files',paths:['src/App.jsx','src/ui/Button.jsx']},
      {type:'gallery',images:[{src:'https://example.com/a.png',alt:'Example'}]},
      {type:'image-compare',before:{src:'https://example.com/a.png',alt:'Before'},after:{src:'https://example.com/b.png',alt:'After'}},
      {type:'code-compare',before:'const n = 1;',after:'const n = 2;'},
      {type:'receipt',currency:'USD',items:[{label:'Hotel',amount:480},{label:'Food',amount:160},{label:'Travel',amount:75}]},
      {type:'qr',url:'https://react.dev/'},
      {type:'model',src:'https://example.com/a.glb',alt:'Example model'},
    ];
    for (const sample of samples) {
      const json = JSON.stringify(sample);
      for (const language of ['vaelo-ui','json','','application/json']) {
        const content = `Here is your answer.\n\n~~~${language}\n${json}\n~~~`;
        for (const props of [{}, {mapped:true}, {live:true}]) {
          const html = render(content, props);
          assert.match(html, /class="rich-block"/, `${sample.type}/${language}/${JSON.stringify(props)}`);
          assert.doesNotMatch(html, /block-fallback|class="code-figure"/);
        }
        assert.doesNotMatch(render(content, {}, 'minimal'), /class="rich-block"/);
        assert.doesNotMatch(render(content, {requestText:'Return only JSON.'}), /class="rich-block"/);
        assert.doesNotMatch(render(content, {requestText:'Use plain text.'}), /class="rich-block"/);
      }
      assert.match(render(json), /class="rich-block"/, `bare ${sample.type}`);
    }
    const json = JSON.stringify({type:'overview',title:'Trip Budget',items:[{label:'Hotel',value:'$480'},{label:'Food',value:'$160'},{label:'Travel',value:'$75'},{label:'Total',value:'$715'}]});
    const screenshot = render(`Here's your trip bento overview:\n\n\`\`\`\n${json}\n\`\`\``);
    assert.match(screenshot, /Overview cards/);
    assert.ok(screenshot.indexOf('>Total<') < screenshot.indexOf('>Hotel<'));
    for (const language of ['json','vaelo-ui','']) {
      assert.match(render(`~~~${language}\n{"type":"overview","items":[`, {live:true}), /Preparing this view/);
      assert.doesNotMatch(render(`~~~${language}\n{"type":"overview","items":[`, {live:true}, 'minimal'), /Preparing this view/);
      assert.doesNotMatch(render(`~~~${language}\n{"type":"overview","items":[`), /class="rich-block"/);
      assert.doesNotMatch(render(`~~~${language}\n{"type":"gallery","images":[{"src":"javascript:alert(1)","alt":"unsafe"}]}\n~~~`), /class="rich-block"|src="javascript:/);
    }
    assert.doesNotMatch(render(`~~~javascript\n${json}\n~~~`), /class="rich-block"/);
    const exact = JSON.stringify({type:'overview',items:[{label:'**literal**',value:'[word](https://example.com)'}]});
    const bare = render(exact, {mapped:true});
    assert.match(bare, /\*\*literal\*\*/);
    assert.match(bare, /\[word\]\(https:\/\/example.com\)/);
    assert.match(bare, /data-src="0:/);
    assert.doesNotMatch(render('~~~json\n{"type":"invoice","value":123}\n~~~'), /class="rich-block"/);
  } finally { await server.close(); }
});
