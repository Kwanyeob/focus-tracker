const activeWin = require('active-win');
const {uIOhook} = require('uiohook-napi');



let lastTitle = '';

let mouseAndKeyMetric = {
    keyStrokes: 0,
    mouseClick: 0,
    mouseDistance: 0
};

let lastMousePos = null;

uIOhook.on('keydown', event => {
    if(event){
        mouseAndKeyMetric.keyStrokes += 1;
    }
});

uIOhook.on('mousedown', event => {
    if(event){
        mouseAndKeyMetric.mouseClick += 1;
    }
});

uIOhook.on('mousemove', event => {
    if (event) {
        if (lastMousePos) {
            const dx = event.x - lastMousePos.x;
            const dy = event.y - lastMousePos.y;
            mouseAndKeyMetric.mouseDistance += Math.sqrt(dx * dx + dy * dy);
        }
        lastMousePos = { x: event.x, y: event.y };
    }
});

async function collectData() {
    try {
        const window = await activeWin();
        if (window){

            const snapShot ={
                appName: window.owner.name,
                title: window.title,
                mouseAndKeyMetric: {...mouseAndKeyMetric},
                timestamp: new Date().toLocaleTimeString()
            }
            console.clear();
            console.log("real time monitor")
            console.log(JSON.stringify(snapShot, null, 2));
            lastTitle = window.title;
            mouseAndKeyMetric.keyStrokes = 0;
            mouseAndKeyMetric.mouseClick = 0;
            mouseAndKeyMetric.mouseDistance = 0;
            
        }
    } catch (error) {
        console.error('Error fetching active window:', error);
    }
}

uIOhook.start();
console.log('Monitoring active window titles.');
setInterval(collectData, 1000);