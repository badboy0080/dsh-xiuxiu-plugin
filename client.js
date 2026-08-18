// 修仙者 Token 消耗统计 —— Client 半部分（动态 Cordis 插件）
//
// 职责：
//   1. 挂在 shell.overlay（右下角悬浮层），渲染 120px 透明背景像素角色
//   2. 每 350ms 轮询 Host 的 getState，显示称号 + 实时 token 数
//   3. 工作状态：18 个发光粒子从四周向角色体内汇聚 + 金色呼吸辉光 + 角色浮动
//   4. token 结算：+XXXX 上漂 → 停顿 2s → 爆炸成 24 粒子拖尾飞向角色消失
//   5. 大境界突破：金光渡劫动画；九阶用 CSS 滤镜换配色
//
// 注意：这是动态 Cordis 插件的 Client 函数体，纯 JS + React.createElement（无 JSX）。

return {
  inject: ['timer'],
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return

    styles.insert(`
      .xiuxiu-root{position:fixed;right:16px;bottom:16px;z-index:9999;display:flex;flex-direction:column;align-items:center;gap:4px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;cursor:pointer;user-select:none;transition:transform .2s ease;}
      .xiuxiu-root .xiuxiu-label{display:flex;flex-direction:column;align-items:center;gap:2px;text-align:center;}
      .xiuxiu-title{font-size:14px;font-weight:700;letter-spacing:.5px;color:#e5e7eb;text-shadow:0 1px 2px rgba(0,0,0,.8);}
      .xiuxiu-tokens{font-size:13px;font-variant-numeric:tabular-nums;color:#fbbf24;text-shadow:0 1px 2px rgba(0,0,0,.8);}
      .xiuxiu-figure{position:relative;width:120px;height:120px;display:flex;align-items:center;justify-content:center;}
      .xiuxiu-sprite{position:relative;z-index:1;width:120px;height:120px;object-fit:contain;image-rendering:pixelated;transition:filter .6s ease;}
      .xiuxiu-figure svg{position:relative;z-index:1;transform:scale(2.4);transform-origin:center;}
      .xiuxiu-figure::before{content:'';position:absolute;left:50%;top:50%;width:120px;height:120px;transform:translate(-50%,-50%);border-radius:50%;background:radial-gradient(circle,rgba(252,211,77,.4) 0%,rgba(252,211,77,.12) 45%,rgba(252,211,77,0) 70%);opacity:0;transition:opacity .4s ease;pointer-events:none;z-index:0;}
      .xiuxiu-root.working .xiuxiu-figure::before{opacity:1;animation:xiuxiu-glow 1.4s ease-in-out infinite;}
      .xiuxiu-particles{position:absolute;left:50%;top:50%;width:0;height:0;pointer-events:none;opacity:0;transition:opacity .4s ease;z-index:2;}
      .xiuxiu-root.working .xiuxiu-particles{opacity:1;}
      .xiuxiu-particle{position:absolute;left:0;top:0;width:var(--size);height:var(--size);border-radius:50%;background:var(--color);box-shadow:0 0 6px var(--color),0 0 14px var(--color);opacity:0;transform:translate(var(--tx),var(--ty));animation-play-state:paused;animation:xiuxiu-in var(--dur) ease-in var(--delay) infinite;}
      .xiuxiu-root.working .xiuxiu-particle{animation-play-state:running;}
      .xiuxiu-root.working .xiuxiu-figure{animation:xiuxiu-bob .6s ease-in-out infinite;}
      .xiuxiu-root.idle .xiuxiu-figure{animation:xiuxiu-breathe 3s ease-in-out infinite;}
      .xiuxiu-root.breaking .xiuxiu-figure{animation:xiuxiu-break 2.6s ease-out forwards;}
      .xiuxiu-gain{position:absolute;left:50%;top:50%;font-size:14px;font-weight:700;font-variant-numeric:tabular-nums;color:#4ade80;text-shadow:0 1px 3px rgba(0,0,0,.85);pointer-events:none;white-space:nowrap;transform:translate(-50%,-72px);animation:xiuxiu-gain-float 3s cubic-bezier(.3,.6,.4,1) forwards;z-index:3;}
      .xiuxiu-gain-burst{position:absolute;left:50%;top:50%;width:0;height:0;pointer-events:none;z-index:3;}
      .xiuxiu-gain-particle{position:absolute;left:0;top:0;width:var(--size);height:var(--size);border-radius:50%;background:var(--color);box-shadow:0 0 4px var(--color),0 0 8px var(--color),0 0 16px var(--color);opacity:0;transform:translate(-50%,-198px);animation:xiuxiu-gain-burst 1s cubic-bezier(.3,.7,.4,1) var(--delay) forwards;}
      .xiuxiu-detail{display:none;flex-direction:column;gap:4px;width:200px;padding:8px 10px;background:rgba(17,24,39,.92);border:1px solid rgba(255,255,255,.1);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.5);}
      .xiuxiu-root:hover .xiuxiu-detail{display:flex;}
      .xiuxiu-progress{height:6px;border-radius:3px;background:rgba(255,255,255,.12);overflow:hidden;}
      .xiuxiu-progress-fill{height:100%;border-radius:3px;background:linear-gradient(90deg,#fbbf24,#f59e0b);transition:width .3s ease;}
      .xiuxiu-next{font-size:11px;color:#d1d5db;line-height:1.4;}
      .xiuxiu-root.collapsed .xiuxiu-label,.xiuxiu-root.collapsed .xiuxiu-detail{display:none!important;}
      .xiuxiu-root.collapsed .xiuxiu-figure{width:44px;height:44px;}
      .xiuxiu-root.collapsed .xiuxiu-sprite{width:44px;height:44px;}
      .xiuxiu-root.collapsed .xiuxiu-figure svg{transform:scale(.9);}
      .xiuxiu-root.collapsed .xiuxiu-particles{display:none;}
      @keyframes xiuxiu-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
      @keyframes xiuxiu-breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.02)}}
      @keyframes xiuxiu-break{0%{transform:scale(1);filter:none}30%{transform:scale(1.15);filter:drop-shadow(0 0 16px rgba(251,191,36,.95))}60%{transform:scale(1.05);filter:drop-shadow(0 0 30px rgba(251,191,36,.85))}100%{transform:scale(1);filter:none}}
      @keyframes xiuxiu-glow{0%,100%{opacity:.5;transform:translate(-50%,-50%) scale(.92)}50%{opacity:1;transform:translate(-50%,-50%) scale(1.08)}}
      @keyframes xiuxiu-in{0%{transform:translate(var(--tx),var(--ty)) scale(1);opacity:0}8%{opacity:1}70%{opacity:.95}100%{transform:translate(0,0) scale(.15);opacity:0}}
      @keyframes xiuxiu-gain-float{0%{opacity:0;transform:translate(-50%,-70px) scale(.5)}10%{opacity:1;transform:translate(-50%,-90px) scale(1)}30%{opacity:1;transform:translate(-50%,-198px) scale(1)}92%{opacity:1;transform:translate(-50%,-198px) scale(1)}100%{opacity:1;transform:translate(-50%,-198px) scale(.3)}}
      @keyframes xiuxiu-gain-burst{0%{transform:translate(-50%,-198px);opacity:1}22%{transform:translate(-50%,-198px) translate(var(--bx),var(--by));opacity:1}100%{transform:translate(-50%,-50%) scale(.12);opacity:0}}
    `)

    const FILTERS = [
      'hue-rotate(0deg) saturate(0.85)',
      'hue-rotate(90deg) saturate(1.1)',
      'hue-rotate(40deg) saturate(1.4) brightness(1.05)',
      'hue-rotate(250deg) saturate(1.2)',
      'hue-rotate(200deg) saturate(1.25)',
      'hue-rotate(160deg) saturate(1.15)',
      'hue-rotate(300deg) saturate(0.65) brightness(1.1)',
      'hue-rotate(20deg) saturate(1.5) brightness(1.1)',
      'hue-rotate(320deg) saturate(1.6) brightness(1.05)',
    ]
    const ROBES = ['#6b7280', '#16a34a', '#eab308', '#8b5cf6', '#3b82f6', '#06b6d4', '#94a3b8', '#f59e0b', '#ef4444']
    const ACCENTS = ['#4b5563', '#15803d', '#ca8a04', '#6d28d9', '#1d4ed8', '#0e7490', '#64748b', '#dc2626', '#991b1b']

    const PARTICLES = (() => {
      const arr = []
      const N = 18
      for (let i = 0; i < N; i++) {
        const angle = (i / N) * Math.PI * 2
        const radius = 62 + (i % 6) * 5
        arr.push({
          tx: Math.round(Math.cos(angle) * radius),
          ty: Math.round(Math.sin(angle) * radius),
          delay: Math.round(((i * 0.73) % 1.8) * 100) / 100,
          dur: 1.5 + (i % 3) * 0.25,
          size: 3 + (i % 3),
          color: i % 5 === 0 ? '#a5f3fc' : '#fcd34d',
        })
      }
      return arr
    })()

    const BURST_PARTICLES = (() => {
      const arr = []
      const N = 24
      for (let i = 0; i < N; i++) {
        const angle = (i / N) * Math.PI * 2
        const r = 22 + (i % 5) * 4
        arr.push({
          bx: Math.round(Math.cos(angle) * r),
          by: Math.round(Math.sin(angle) * r),
          delay: Math.round(((i % 6) * 0.025) * 100) / 100,
          size: 2 + (i % 4),
          color: i % 6 === 0 ? '#a5f3fc' : '#fcd34d',
        })
      }
      return arr
    })()

    function thousands(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',') }
    function formatTokens(n) {
      if (n < 10000) return thousands(Math.floor(n))
      if (n < 100000000) return trim(n / 10000) + '万'
      return trim(n / 100000000) + '亿'
    }
    function trim(x) {
      const v = Math.round(x * 10) / 10
      return String(v).replace(/\.0$/, '')
    }

    const GRID = [
      '..HHHH..',
      '.HHHHHH.',
      '.HSSSSH.',
      '.HSEESH.',
      '..SSSS..',
      '..RRRR..',
      '.RRRRRR.',
      '.SR..RS.',
      '..RRRR..',
      '.RR..RR.',
      '.AA..AA.',
      '.AA..AA.',
    ]
    const CELL = 4

    function renderFigure(robe, accent) {
      const colorOf = { H: '#1f2937', S: '#fcd9b6', E: '#111827', R: robe, A: accent }
      const rects = []
      GRID.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
          const ch = row[x]
          if (ch === '.') continue
          rects.push(React.createElement('rect', {
            key: y + '-' + x,
            x: x * CELL, y: y * CELL, width: CELL, height: CELL,
            fill: colorOf[ch],
          }))
        }
      })
      return React.createElement('svg', {
        width: 32, height: 48, viewBox: '0 0 32 48',
        style: { shapeRendering: 'crispEdges' },
      }, rects)
    }

    let seenSeq = -1
    let seenGainSeq = -1
    let gainId = 0

    function Xiuxiu() {
      const [state, setState] = React.useState(null)
      const [sprite, setSprite] = React.useState(null)
      const [collapsed, setCollapsed] = React.useState(false)
      const [breaking, setBreaking] = React.useState(false)
      const [breakFrom, setBreakFrom] = React.useState(null)
      const [gains, setGains] = React.useState([])

      React.useEffect(() => {
        let alive = true
        const poll = async () => {
          let s
          try { s = await host.call('getState') } catch (e) { return }
          if (!alive || !s) return
          setState(s)
          if (s.breakthroughSeq > seenSeq) {
            const first = seenSeq === -1
            seenSeq = s.breakthroughSeq
            if (!first) {
              setBreakFrom(s.breakthrough ? s.breakthrough.from : s.realmIndex)
              setBreaking(true)
              ctx.timeout(() => { setBreaking(false); setBreakFrom(null) }, 2600)
            }
          }
          if (s.gainSeq > seenGainSeq) {
            const first = seenGainSeq === -1
            seenGainSeq = s.gainSeq
            if (!first && s.lastGain > 0) {
              const gid = gainId + 1
              gainId = gid
              setGains(prev => prev.concat([{ id: gid, amount: s.lastGain, phase: 'float' }]))
              ctx.timeout(() => {
                setGains(prev => prev.map(g => g.id === gid ? { ...g, phase: 'burst' } : g))
              }, 3000)
              ctx.timeout(() => {
                setGains(prev => prev.filter(g => g.id !== gid))
              }, 4300)
            }
          }
        }
        const loadSprite = async () => {
          try {
            const sp = await host.call('getSprite')
            if (alive && sp) setSprite(sp)
          } catch (e) { /* fall back to SVG grid */ }
        }
        poll()
        loadSprite()
        const stop = ctx.interval(poll, 350)
        return () => { alive = false; stop() }
      }, [])

      const s = state || { tokens: 0, working: false, realmIndex: 0, title: '炼气一层', nextTitle: '炼气二层', progress: 0, remaining: 0 }
      const displayRealm = breakFrom !== null ? breakFrom : s.realmIndex
      const f = FILTERS[displayRealm] || FILTERS[0]
      const mode = breaking ? 'breaking' : (s.working ? 'working' : 'idle')
      const cls = 'xiuxiu-root ' + mode + (collapsed ? ' collapsed' : '')
      const title = breaking ? '⚡ 突破中' : s.title

      const body = sprite
        ? React.createElement('img', { className: 'xiuxiu-sprite', src: sprite, alt: '', style: { filter: f } })
        : renderFigure(ROBES[displayRealm] || '#6b7280', ACCENTS[displayRealm] || '#4b5563')

      const particles = React.createElement('div', { className: 'xiuxiu-particles' },
        PARTICLES.map((pt, i) => React.createElement('span', {
          key: 'p' + i,
          className: 'xiuxiu-particle',
          style: {
            '--tx': pt.tx + 'px',
            '--ty': pt.ty + 'px',
            '--delay': pt.delay + 's',
            '--dur': pt.dur + 's',
            '--size': pt.size + 'px',
            '--color': pt.color,
          },
        })),
      )

      const gainEls = gains.map(g => {
        if (g.phase === 'burst') {
          return React.createElement('div', { key: g.id, className: 'xiuxiu-gain-burst' },
            BURST_PARTICLES.map((bp, i) => React.createElement('span', {
              key: 'b' + i,
              className: 'xiuxiu-gain-particle',
              style: {
                '--bx': bp.bx + 'px',
                '--by': bp.by + 'px',
                '--delay': bp.delay + 's',
                '--size': bp.size + 'px',
                '--color': bp.color,
              },
            })),
          )
        }
        return React.createElement('span', {
          key: g.id,
          className: 'xiuxiu-gain',
        }, '+' + thousands(g.amount))
      })

      return React.createElement('div', {
        className: cls,
        onClick: () => setCollapsed(v => !v),
      },
        React.createElement('div', { className: 'xiuxiu-label' },
          React.createElement('div', { className: 'xiuxiu-title' }, title),
          React.createElement('div', { className: 'xiuxiu-tokens' }, formatTokens(s.tokens)),
        ),
        React.createElement('div', { className: 'xiuxiu-figure' },
          body,
          particles,
          gainEls,
        ),
        React.createElement('div', { className: 'xiuxiu-detail' },
          React.createElement('div', { className: 'xiuxiu-progress' },
            React.createElement('div', { className: 'xiuxiu-progress-fill', style: { width: (s.progress * 100) + '%' } }),
          ),
          React.createElement('div', { className: 'xiuxiu-next' },
            s.nextTitle ? ('距 ' + s.nextTitle + ' 还差 ' + formatTokens(s.remaining)) : '已登顶 · 仙途圆满',
          ),
        ),
      )
    }

    slots.inject('shell.overlay', () => slots.register(
      { name: 'shell.overlay', id: 'xiuxiu-token-cultivator' },
      () => React.createElement(Xiuxiu),
    ))
  },
}
