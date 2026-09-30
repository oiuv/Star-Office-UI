const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const bubbles = require('../frontend/speech-bubbles.js');

const segmenter = new Intl.Segmenter(undefined, {granularity: 'grapheme'});
function measure(text) {
    return [...segmenter.segment(text)].reduce((sum, {segment}) =>
        sum + (/^[\x00-\x7f]+$/.test(segment) ? (segment === 'W' ? 14 : 7) : 14), 0);
}
function scene(width=1280,height=720) {
    const result = {scale:{gameSize:{width,height}},created:[]};
    result.add = {
        text(x,y,value,style) {
            const object = {x,y,context:{measureText: text => ({width:measure(text)})},
                setOrigin(){return this;}};
            const lines = style.wordWrap.callback(value,object);
            object.lines=lines;
            object.width=Math.max(...lines.map(measure));
            object.height=lines.length * parseInt(style.fontSize) + (lines.length-1)*style.lineSpacing;
            return object;
        },
        rectangle(x,y,width,height) {
            return {x,y,width,height,setStrokeStyle(){return this;}};
        },
        container(x,y,list) {
            const object={scene:result,x,y,list,destroyed:false,
                setPosition(x,y){this.x=x;this.y=y;return this;},
                setDepth(depth){this.depth=depth;return this;},
                destroy(){this.destroyed=true;}};
            result.created.push(object);
            return object;
        }
    };
    return result;
}
function inside(bubble) {
    const {width,height}=bubble.__layout;
    const {width:sceneWidth,height:sceneHeight}=bubble.scene.scale.gameSize;
    assert.ok(bubble.x-width/2 >= 9.99);
    assert.ok(bubble.x+width/2 <= sceneWidth-9.99);
    assert.ok(bubble.y-height/2 >= 9.99);
    assert.ok(bubble.y+height/2 <= sceneHeight-9.99);
    assert.ok(bubble.list[1].width <= width-28);
    assert.ok(bubble.list[1].height <= height-18);
}
test('Chinese paragraphs wrap by measured width without losing characters',()=>{
    const value='正在检查当前项目中的工具调用记录，修复聊天气泡宽度和长文本显示的问题。';
    const lines=bubbles.wrapText(value,measure,112);
    assert.ok(lines.length>1);
    assert.equal(lines.join(''),value);
    assert.ok(lines.every(line=>measure(line)<=112));
});
test('English words retain boundaries and unbroken tool names also fit',()=>{
    const value='Running checks for mcp__browser__really_long_tool_name_without_spaces';
    const lines=bubbles.wrapText(value,measure,126);
    assert.equal(lines[0],'Running checks for');
    assert.ok(lines.every(line=>measure(line)<=126));
    assert.equal(lines.join('').replaceAll(' ',''),value.replaceAll(' ',''));
});
test('Emoji graphemes and explicit newlines survive wrapping',()=>{
    const lines=bubbles.wrapText('准备👩‍💻检查🐈‍⬛项目\r\n\n下一步',measure,56);
    assert.ok(lines.includes(''));
    assert.equal(lines.join('').replaceAll(' ',''),'准备👩‍💻检查🐈‍⬛项目下一步');
    assert.ok(lines.some(line=>line.includes('👩‍💻')));
    assert.ok(lines.some(line=>line.includes('🐈‍⬛')));
});
test('A measured multi-line bubble fits all four edges and keeps padding',()=>{
    for(const [x,y] of [[0,0],[1280,0],[0,720],[1280,720]]) {
        const bubble=bubbles.create(scene(),'很长的说明文字，包含中文和一个工具名字 mcp__search__documents',x,y);
        inside(bubble);
        assert.ok(bubble.list[1].lines.length>1);
        assert.ok(bubble.__layout.width<=320);
    }
});
test('Repositioning a moving visitor keeps local children aligned',()=>{
    const bubble=bubbles.create(scene(),'正在研究资料',100,200);
    bubbles.position(bubble,1280,700);
    inside(bubble);
    assert.equal(bubble.list[0].x,0);
    assert.equal(bubble.list[1].x,0);
});
test('Narrow viewports and extremely long text stay within the scene',()=>{
    const bubble=bubbles.create(scene(220,180),'很长的文字'.repeat(200),0,0,{fontSize:16});
    inside(bubble);
    assert.ok(bubble.list[1].lines.at(-1).endsWith('…'));
    assert.ok(bubble.__layout.width<=200);
});
test('Longer text gets more reading time with a bounded duration',()=>{
    assert.equal(bubbles.duration('待命'),3200);
    assert.equal(bubbles.duration('短句',4000),4000);
    assert.equal(bubbles.duration('字'.repeat(80)),7200);
    assert.equal(bubbles.duration('字'.repeat(1000)),12000);
});

for(const file of ['frontend/index.html','frontend/electron-standalone.html']) {
    const html=fs.readFileSync(file,'utf8');
    function fixture() {
        const context = {
            OfficeBubbles:bubbles,game:scene(),IS_TOUCH_DEVICE:false,currentState:'executing',
            star:{x:1200,y:350,visible:true},syncAnimSprite:null,window:{},
            bubble:null,getBubbleTextsByState:()=>['检查项目中的长文本与工具名称 mcp__browser__search_documents'],
            timers:[],setTimeout(callback){context.timers.push(callback);}
        };
        vm.createContext(context);
        const start=html.indexOf('        function showBubble() {');
        const end=html.indexOf('        function showCatBubble()',start);
        vm.runInContext(html.slice(start,end),context);
        return context;
    }
    test(file+' loads measured bubbles before game initialization',()=>{
        const initialization = html.search(/\b(?:async\s+)?function\s+initGame\b/);
        assert.ok(initialization > 0);
        assert.ok(html.indexOf('/static/speech-bubbles.js') < initialization);
    });
    test(file+' uses bounded layout and old timers cannot destroy new bubbles',()=>{
        const f=fixture();
        vm.runInContext('showBubble()',f);
        const first=f.bubble;
        inside(first);
        vm.runInContext('showBubble()',f);
        const second=f.bubble;
        assert.ok(first.destroyed);
        f.timers[0]();
        assert.equal(f.bubble,second);
        assert.equal(second.destroyed,false);
        f.timers[1]();
        assert.equal(f.bubble,null);
        assert.ok(second.destroyed);
    });
    test(file+' anchors sync and error bubbles to the visible cat',()=>{
        for(const state of ['syncing','error']) {
            const f=fixture();
            f.currentState=state;
            const sprite={x:state==='syncing'?1157:1007,y:state==='syncing'?592:221,visible:true};
            if(state==='syncing') f.syncAnimSprite=sprite;
            else f.window.errorBug=sprite;
            vm.runInContext('showBubble()',f);
            assert.equal(f.bubble.__followSprite,sprite);
            inside(f.bubble);
        }
    });
}
