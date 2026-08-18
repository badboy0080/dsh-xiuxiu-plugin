// 修仙者 Token 消耗统计 —— Host 半部分（动态 Cordis 插件）
//
// 职责：
//   1. 监听全局 llm/stream 事件，累计所有会话的 token 消耗（输入+输出+缓存），只增不减
//   2. 按九阶境界 + 36 子层计算称号，检测大境界突破
//   3. 运行时读取角色图片 1.png 并转 base64 下发（换角色 = 替换图片文件即可）
//   4. 修为持久化到工作区 .xiuxiu-cultivation.json，重启续算
//
// 注意：这是动态 Cordis 插件的 Host 函数体，运行在受限沙箱中（纯 JS，无 Node Buffer）。
// 通过 harness.handle 暴露 getState / getSprite 两个 Package 私有 RPC 给 Client。

return {
  inject: ['timer'],
  apply(ctx) {
    const fs = ctx.get('fs')
    const sandboxPolicy = ctx.get('sandboxPolicy')

    const REALMS = [
      { name: '炼气', threshold: 0, sublevels: 12 },
      { name: '筑基', threshold: 100000, sublevels: 3 },
      { name: '金丹', threshold: 500000, sublevels: 3 },
      { name: '元婴', threshold: 2000000, sublevels: 3 },
      { name: '化神', threshold: 10000000, sublevels: 3 },
      { name: '炼虚', threshold: 50000000, sublevels: 3 },
      { name: '合体', threshold: 200000000, sublevels: 3 },
      { name: '大乘', threshold: 1000000000, sublevels: 3 },
      { name: '渡劫', threshold: 5000000000, sublevels: 3 },
    ]
    const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二']
    const STAGE = ['初期', '中期', '后期']
    const SUB_Q = 1.3

    let cultivation = 0
    let pendingEstimate = 0
    let workingCount = 0
    let realmIndex = 0
    let breakthroughSeq = 0
    let lastBreakthrough = null
    let lastGain = 0
    let gainSeq = 0

    function subThresholds(ri) {
      const r = REALMS[ri]
      const start = r.threshold
      const end = ri + 1 < REALMS.length ? REALMS[ri + 1].threshold : r.threshold * 2
      const n = r.sublevels
      const L = end - start
      const d0 = L * (SUB_Q - 1) / (Math.pow(SUB_Q, n) - 1)
      const ts = []
      for (let j = 0; j <= n; j++) ts.push(start + d0 * (Math.pow(SUB_Q, j) - 1) / (SUB_Q - 1))
      return ts
    }

    function locate(v) {
      let ri = REALMS.length - 1
      for (let i = 0; i < REALMS.length; i++) {
        if (v < REALMS[i].threshold) { ri = i - 1; break }
      }
      if (ri < 0) ri = 0
      const ts = subThresholds(ri)
      let si = ts.length - 2
      for (let j = 0; j < ts.length - 1; j++) {
        if (v < ts[j + 1]) { si = j; break }
      }
      return { ri, si, lo: ts[si], hi: ts[si + 1] }
    }

    function subName(ri, si) {
      return ri === 0 ? CN[si] + '层' : STAGE[si]
    }
    function titleOf(ri, si) { return REALMS[ri].name + subName(ri, si) }

    function snapshot() {
      const loc = locate(cultivation)
      const isPeak = loc.ri === REALMS.length - 1 && loc.si === REALMS[loc.ri].sublevels - 1
      let nextTitle = null
      if (!isPeak) {
        const nextSi = loc.si + 1 < REALMS[loc.ri].sublevels ? loc.si + 1 : 0
        const nextRi = loc.si + 1 < REALMS[loc.ri].sublevels ? loc.ri : Math.min(loc.ri + 1, REALMS.length - 1)
        nextTitle = titleOf(nextRi, nextSi)
      }
      const progress = loc.hi > loc.lo ? Math.max(0, Math.min(1, (cultivation - loc.lo) / (loc.hi - loc.lo))) : 1
      return {
        tokens: Math.round(cultivation + pendingEstimate),
        settled: Math.round(cultivation),
        working: workingCount > 0,
        realmIndex: loc.ri,
        subIndex: loc.si,
        realm: REALMS[loc.ri].name,
        title: titleOf(loc.ri, loc.si),
        nextTitle,
        progress,
        remaining: Math.round(Math.max(0, loc.hi - cultivation)),
        breakthroughSeq,
        breakthrough: lastBreakthrough,
        lastGain,
        gainSeq,
      }
    }

    // 纯 JS base64（Host 沙箱 btoa 只支持 UTF-8 文本，二进制字节需手动编码）
    function bytesToBase64(bytes) {
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
      const parts = []
      let i = 0
      for (; i + 2 < bytes.length; i += 3) {
        const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
        parts.push(alphabet[(n >> 18) & 63], alphabet[(n >> 12) & 63], alphabet[(n >> 6) & 63], alphabet[n & 63])
      }
      const rem = bytes.length - i
      if (rem === 1) {
        const n = bytes[i] << 16
        parts.push(alphabet[(n >> 18) & 63], alphabet[(n >> 12) & 63], '==')
      } else if (rem === 2) {
        const n = (bytes[i] << 16) | (bytes[i + 1] << 8)
        parts.push(alphabet[(n >> 18) & 63], alphabet[(n >> 12) & 63], alphabet[(n >> 6) & 63], '=')
      }
      return parts.join('')
    }

    let spriteCache = null
    let spriteAttempted = false
    async function loadSprite() {
      if (spriteAttempted) return spriteCache
      spriteAttempted = true
      if (!fs) return null
      // 换角色：把新图命名为 1.png 放在这些候选路径之一，重启插件即可
      const candidates = ['G:\\AICoding\\DeepseekHarness工作区\\1.png']
      if (sandboxPolicy && sandboxPolicy.workspaceRoot) {
        candidates.push(sandboxPolicy.workspaceRoot + '/1.png')
        candidates.push(sandboxPolicy.workspaceRoot + '\\1.png')
      }
      for (const p of candidates) {
        try {
          const target = await fs.resolve(p)
          const bytes = await fs.readBytes(target, undefined, 10485760)
          if (bytes && bytes.length > 0) {
            spriteCache = 'data:image/png;base64,' + bytesToBase64(bytes)
            return spriteCache
          }
        } catch (e) { /* try next candidate */ }
      }
      return null
    }

    const ledgerPath = sandboxPolicy && sandboxPolicy.workspaceRoot
      ? sandboxPolicy.workspaceRoot + '/.xiuxiu-cultivation.json'
      : null

    async function load() {
      if (!fs || !ledgerPath) return
      try {
        const target = await fs.resolve(ledgerPath)
        const text = await fs.readText(target)
        const data = JSON.parse(text)
        if (typeof data.cultivation === 'number' && data.cultivation > 0) {
          cultivation = data.cultivation
          realmIndex = locate(cultivation).ri
        }
      } catch (e) { /* first run or unreadable ledger */ }
    }

    const save = ctx.debounce(async () => {
      if (!fs || !ledgerPath) return
      try {
        const target = await fs.resolve(ledgerPath)
        await fs.writeText(target, JSON.stringify({ cultivation, updatedAt: Date.now() }))
      } catch (e) { /* ignore persistence failure */ }
    }, 1000)

    load()

    ctx.on('llm/stream', async function * (options, next) {
      workingCount += 1
      try {
        for await (const chunk of next()) {
          if (chunk && chunk.type === 'text-delta' && typeof chunk.text === 'string') {
            pendingEstimate += Math.ceil(chunk.text.length / 2)
          } else if (chunk && chunk.type === 'reasoning-delta' && typeof chunk.text === 'string') {
            pendingEstimate += Math.ceil(chunk.text.length / 2)
          } else if (chunk && chunk.type === 'usage' && chunk.usage) {
            const u = chunk.usage
            const gain = (u.inputTokens || 0) + (u.outputTokens || 0)
              + (u.cacheReadTokens || 0) + (u.cacheWriteTokens || 0)
            cultivation += gain
            lastGain = gain
            gainSeq += 1
            pendingEstimate = 0
            const loc = locate(cultivation)
            if (loc.ri > realmIndex) {
              breakthroughSeq += 1
              lastBreakthrough = { seq: breakthroughSeq, from: realmIndex, to: loc.ri, at: Math.round(cultivation) }
              realmIndex = loc.ri
            }
            save()
          }
          yield chunk
        }
      } finally {
        pendingEstimate = 0
        workingCount -= 1
        save()
      }
    })

    harness.handle('getState', () => snapshot())
    harness.handle('getSprite', () => loadSprite())
  },
}
