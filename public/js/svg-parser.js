/**
 * svg-parser.js — Browser SVG Parser (UMD)
 */
(function(root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.SVGParser = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function() {

class SVGParser {
  parse(svgText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');
    const errNode = doc.querySelector('parsererror');
    if (errNode) throw new Error('SVG غير صالح: ' + errNode.textContent);

    const svgEl = doc.documentElement;
    const transform = this._getRootTransform(svgEl);
    const shapes = [];

    svgEl.querySelectorAll('line,rect,circle,ellipse,polyline,polygon,path').forEach(el => {
      const parsed = this._parseElement(el, transform);
      if (parsed) shapes.push(...parsed);
    });
    return shapes;
  }

  _getRootTransform(svgEl) {
    const vb = svgEl.getAttribute('viewBox');
    const w  = parseFloat(svgEl.getAttribute('width')  || 100);
    const h  = parseFloat(svgEl.getAttribute('height') || 100);
    if (!vb) return { sx: 1, sy: 1, tx: 0, ty: 0, totalH: h };
    const [vx, vy, vw, vh] = vb.split(/[\s,]+/).map(Number);
    return { sx: w / vw, sy: h / vh, tx: -vx * w / vw, ty: -vy * h / vh, totalH: h };
  }

  _tx(x, t) { return x * t.sx + t.tx; }
  _ty(y, t) { return y * t.sy + t.ty; }

  _parseElement(el, t) {
    const tag = el.tagName.toLowerCase().replace(/^.*:/, '');
    switch (tag) {
      case 'line': return [{ type:'line',
        x1:this._tx(+el.getAttribute('x1')||0,t), y1:this._ty(+el.getAttribute('y1')||0,t),
        x2:this._tx(+el.getAttribute('x2')||0,t), y2:this._ty(+el.getAttribute('y2')||0,t) }];

      case 'rect': {
        const x=this._tx(+el.getAttribute('x')||0,t);
        const y=this._ty(+el.getAttribute('y')||0,t);
        const w=(+el.getAttribute('width')||0)*t.sx;
        const h=(+el.getAttribute('height')||0)*t.sy;
        return [{ type:'rect', x, y, w, h }];
      }

      case 'circle': return [{ type:'circle',
        cx:this._tx(+el.getAttribute('cx')||0,t),
        cy:this._ty(+el.getAttribute('cy')||0,t),
        r: (+el.getAttribute('r')||0)*t.sx }];

      case 'ellipse': {
        const cx=this._tx(+el.getAttribute('cx')||0,t);
        const cy=this._ty(+el.getAttribute('cy')||0,t);
        const rx=(+el.getAttribute('rx')||0)*t.sx;
        const ry=(+el.getAttribute('ry')||0)*t.sy;
        const pts=[];
        const seg=64;
        for(let i=0;i<=seg;i++){
          const a=(i/seg)*Math.PI*2;
          pts.push({x:cx+rx*Math.cos(a),y:cy+ry*Math.sin(a)});
        }
        return [{ type:'polyline', points:pts, closed:true }];
      }

      case 'polyline': case 'polygon': {
        const raw = (el.getAttribute('points')||'').trim().split(/[\s,]+/);
        const pts = [];
        for(let i=0;i<raw.length-1;i+=2)
          pts.push({x:this._tx(+raw[i],t), y:this._ty(+raw[i+1],t)});
        return [{ type:'polyline', points:pts, closed: tag==='polygon' }];
      }

      case 'path': return this._parsePath(el.getAttribute('d')||'', t);
      default: return null;
    }
  }

  _parsePath(d, t) {
    const shapes = [];
    let cx=0, cy=0, sx=0, sy=0;
    let curPoly = null;

    const flush = () => {
      if (curPoly && curPoly.points.length>1) { shapes.push(curPoly); curPoly=null; }
    };
    const ensure = (x,y) => {
      if (!curPoly) curPoly = { type:'polyline', points:[{x:this._tx(x,t),y:this._ty(y,t)}] };
    };
    const addPt = (x,y) => {
      if (!curPoly) ensure(x,y);
      else curPoly.points.push({x:this._tx(x,t),y:this._ty(y,t)});
    };

    const cmds = d.match(/[MmLlHhVvCcSsQqTtAaZz][^MmLlHhVvCcSsQqTtAaZz]*/g)||[];

    cmds.forEach(cmd=>{
      const type=cmd[0];
      const nums=(cmd.slice(1).match(/-?[\d.]+(?:e[-+]?\d+)?/gi)||[]).map(Number);
      const abs = type===type.toUpperCase();

      switch(type.toLowerCase()) {
        case 'm':
          flush();
          cx=abs?nums[0]:cx+nums[0]; cy=abs?nums[1]:cy+nums[1];
          sx=cx; sy=cy;
          ensure(cx,cy);
          for(let i=2;i<nums.length-1;i+=2){
            cx=abs?nums[i]:cx+nums[i]; cy=abs?nums[i+1]:cy+nums[i+1];
            addPt(cx,cy);
          }
          break;
        case 'l':
          for(let i=0;i<nums.length-1;i+=2){
            cx=abs?nums[i]:cx+nums[i]; cy=abs?nums[i+1]:cy+nums[i+1]; addPt(cx,cy);
          } break;
        case 'h':
          nums.forEach(v=>{cx=abs?v:cx+v; addPt(cx,cy);}); break;
        case 'v':
          nums.forEach(v=>{cy=abs?v:cy+v; addPt(cx,cy);}); break;
        case 'c':
          for(let i=0;i<nums.length-5;i+=6){
            const ex=abs?nums[i+4]:cx+nums[i+4];
            const ey=abs?nums[i+5]:cy+nums[i+5];
            // Approximate cubic bezier with 12 line segments
            const x1=abs?nums[i]:cx+nums[i],y1=abs?nums[i+1]:cy+nums[i+1];
            const x2=abs?nums[i+2]:cx+nums[i+2],y2=abs?nums[i+3]:cy+nums[i+3];
            for(let s=1;s<=12;s++){
              const u=s/12,v=1-u;
              const bx=v*v*v*cx+3*v*v*u*x1+3*v*u*u*x2+u*u*u*ex;
              const by=v*v*v*cy+3*v*v*u*y1+3*v*u*u*y2+u*u*u*ey;
              addPt(bx,by);
            }
            cx=ex; cy=ey;
          } break;
        case 'z':
          if(curPoly){ curPoly.closed=true; addPt(sx,sy); flush(); }
          cx=sx; cy=sy; break;
      }
    });

    flush();
    return shapes;
  }
}

return SVGParser;
}));
