import * as THREE from 'three'
import earcut from 'earcut'
import { parseBuildings, Path } from './data.js'
import { PAPER, buildingVert, buildingFrag, detailVert, detailFrag, shadowVert, shadowFrag, paperVert, paperFrag, waterVert, waterFrag, flagVert, flagFrag } from './shaders.js'

const raw = (hex) => { const c = new THREE.Color(); c.setStyle(hex, THREE.LinearSRGBColorSpace); return c }

export const LEVEL = { water: 0, other: 5, main: 12, park: 12.8 }

export function createWorld(canvas, base, buildingBuffer, layers, quality) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !quality.lite, alpha: true, stencil: true, powerPreference: 'high-performance' })
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace
  renderer.setClearColor(0x000000, 0)
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(34, 1, 6, 42000)
  const shared = { uSky: { value: raw(PAPER.sky) }, uFog: { value: 14000 }, uCam: { value: camera.position } }
  const reveal = { uReveal: { value: new THREE.Vector3(0, 0, 0) }, uSoft: { value: 520 }, uRing: { value: new THREE.Vector4(0, 0, 0, 0) } }
  const paper = (hex, extra = {}) => new THREE.ShaderMaterial({ vertexShader: paperVert, fragmentShader: paperFrag, uniforms: { ...shared, uColor: { value: raw(hex) } }, ...extra })

  // Harbor
  const waterMat = new THREE.ShaderMaterial({ vertexShader: waterVert, fragmentShader: waterFrag, uniforms: { ...shared, uTime: { value: 0 }, uA: { value: raw(PAPER.harbor) }, uB: { value: raw(PAPER.crest) } } })
  const water = new THREE.Mesh(new THREE.PlaneGeometry(90000, 90000), waterMat); water.rotation.x = -Math.PI / 2; scene.add(water)

  // Land sheets
  const mask = landMask(base)
  scene.add(sheet(base.other, LEVEL.water - 1, LEVEL.other, paper('#e8d9b5', { side: THREE.DoubleSide })))
  addDropShadow(scene, base.main, LEVEL.other + .2, 26, -18)
  scene.add(sheet(base.main, LEVEL.other - 1, LEVEL.main, paper(PAPER.paper, { side: THREE.DoubleSide })))
  scene.add(sheet(base.parks, LEVEL.main - .2, LEVEL.park, paper('#9cc47a', { side: THREE.DoubleSide })))
  scene.add(sheet(base.water, LEVEL.main - 13, LEVEL.water + .4, new THREE.ShaderMaterial({ vertexShader: waterVert, fragmentShader: waterFrag, uniforms: waterMat.uniforms, side: THREE.DoubleSide })))

  // Streets
  const R = base.roads
  scene.add(ribbonMesh([...R.minor], 7.5, mask, paper('#f3e6c6', { side: THREE.DoubleSide }), .32))
  scene.add(ribbonMesh([...R.mid], 12, mask, paper('#eddcb7', { side: THREE.DoubleSide }), .46))
  scene.add(ribbonMesh([...R.major], 17, mask, paper('#e3cda0', { side: THREE.DoubleSide }), .58))
  scene.add(ribbonMesh([...R.link], 13, mask, paper('#cfd2c5', { side: THREE.DoubleSide }), .66))
  scene.add(ribbonMesh([...R.motorway], 30, mask, paper('#aab9b5', { side: THREE.DoubleSide }), .74))

  const dashes = []
  for (const f of R.motorway) { const line = new Path(f); for (let d = 8; d + 16 < line.length; d += 46) { const a = line.at(d), b = line.at(d + 16); dashes.push([a.x, a.y, b.x, b.y]) } }
  scene.add(ribbonMesh(dashes, 1.7, mask, paper('#fff8e8', { side: THREE.DoubleSide }), .86))

  // Rail
  const railY = 1.15
  scene.add(ribbonMesh([base.rail.braintree], 13, mask, paper('#f7e9c9', { side: THREE.DoubleSide }), railY - .1))
  scene.add(ribbonMesh([base.rail.braintree], 7, mask, paper('#d9786c', { side: THREE.DoubleSide }), railY))
  for (const [key, hex] of [['fairmount', PAPER.purple], ['mattapan', PAPER.red], ['ashmont', PAPER.red]]) {
    scene.add(ribbonMesh([base.rail[key]], key === 'ashmont' ? 24 : 18, mask, paper('#fff8e8', { side: THREE.DoubleSide }), railY + .1))
    scene.add(ribbonMesh([base.rail[key]], key === 'ashmont' ? 13 : 9, mask, paper(hex, { side: THREE.DoubleSide }), railY + .25))
  }

  // Buildings
  const buildingU = { ...shared, ...reveal, uBase: { value: LEVEL.main }, uFocus: { value: new THREE.Vector4(0, 0, 1, 0) }, uColor: { value: 0 }, uDetail: { value: 1 } }
  const buildingMat = new THREE.ShaderMaterial({ vertexShader: buildingVert, fragmentShader: buildingFrag, uniforms: buildingU })
  const shadowMat = new THREE.ShaderMaterial({
    vertexShader: shadowVert, fragmentShader: shadowFrag, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { ...reveal, uBase: buildingU.uBase, uSun: { value: new THREE.Vector2(.62, -.46) }, uOpacity: { value: .2 } },
    stencilWrite: true, stencilFunc: THREE.NotEqualStencilFunc, stencilRef: 1, stencilZPass: THREE.ReplaceStencilOp, stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp,
  })
  const detailMat = new THREE.ShaderMaterial({ vertexShader: detailVert, fragmentShader: detailFrag, uniforms: buildingU })
  const tiles = buildTiles(parseBuildings(buildingBuffer), quality)
  const roadIndex = makeRoadIndex([...R.minor, ...R.mid, ...R.major])
  const shadowMeshes = []
  for (const tile of tiles) {
    const g = tile.geometry
    const b = new THREE.Mesh(g, buildingMat); b.renderOrder = 2; scene.add(b)
    const s = new THREE.Mesh(g, shadowMat); s.renderOrder = 1; scene.add(s); shadowMeshes.push(s)
  }
  const detailRange = quality.lite ? 640 : 1050
  function updateDetail(x, north, budget) {
    const t0 = performance.now()
    const near = tiles.filter((t) => !t.detail && Math.hypot(t.cx - x, t.cy - north) < detailRange).sort((a, b) => Math.hypot(a.cx - x, a.cy - north) - Math.hypot(b.cx - x, b.cy - north))
    for (const t of near) {
      const g = buildDetail(t, roadIndex)
      if (g) { t.detail = new THREE.Mesh(g, detailMat); t.detail.renderOrder = 2; scene.add(t.detail) } else t.detail = true
      if (performance.now() - t0 > budget) break
    }
    for (const t of tiles) if (t.detail?.isMesh) t.detail.visible = Math.hypot(t.cx - x, t.cy - north) < detailRange * 1.45
  }

  // Trees
  const treeCount = Math.floor(base.trees.length / 2 / (quality.lite ? 2 : 1))
  const cone = new THREE.ConeGeometry(11, 30, 6); cone.translate(0, 21, 0)
  const trees = new THREE.InstancedMesh(cone, paper('#ffffff'), treeCount)
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), tint = new THREE.Color()
  const greens = ['#5f9b5a', '#7dae5f', '#477f58', '#94b95f']
  for (let i = 0; i < treeCount; i++) {
    const k = quality.lite ? i * 4 : i * 2, s = .75 + ((i * 37) % 11) / 18
    p.set(base.trees[k], LEVEL.park, -base.trees[k + 1]); sc.set(s, s * (1 + (i % 3) * .12), s); m.compose(p, q, sc); trees.setMatrixAt(i, m)
    tint.copy(raw(greens[i % 4])); trees.setColorAt(i, tint)
  }
  scene.add(trees)

  // Gas tank
  const [tx, ty] = base.tank; const tank = new THREE.Group(); tank.position.set(tx, LEVEL.main, -ty)
  const smooth = { defines: { SMOOTH: 1 } }
  const body = new THREE.Mesh(new THREE.CylinderGeometry(50, 50, 72, 64), paper('#fffdf5', smooth)); body.position.y = 36
  const dome = new THREE.Mesh(new THREE.SphereGeometry(73, 64, 12, 0, Math.PI * 2, 0, Math.PI * .24), paper('#f6f0e1', smooth)); dome.scale.y = .5; dome.position.y = 45.4
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(92, 104, 3, 48), paper('#d7cdb3')); ring.position.y = 1.5
  tank.add(body, dome, ring)
  // Plain working-tank details: wall seams, rim and a stair winding up the side. No painted design.
  const ribGeo = new THREE.BoxGeometry(.8, 71, 1.5), railMat = paper('#8d979b'), seamMat = paper('#e7dfcc'), ribMat = paper('#ffffff')
  const pts = []; for (let i = 0; i <= 120; i++) { const k = i / 120, a = .6 + k * Math.PI * 2.5; pts.push(new THREE.Vector3(Math.cos(a) * 52.2, 1 + k * 70.5, Math.sin(a) * 52.2)) }
  const stairGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 240, .75, 6), rimGeo = new THREE.TorusGeometry(50.7, .9, 8, 72), seamGeo = new THREE.TorusGeometry(50.25, .28, 6, 72)
  function dressTank(parent) {
    const ribs = new THREE.InstancedMesh(ribGeo, ribMat, 36), m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), c4 = raw('#e7dfcc')
    for (let i = 0; i < 36; i++) { const a = i / 36 * Math.PI * 2; q4.setFromAxisAngle(up, -a); m4.compose(new THREE.Vector3(Math.cos(a) * 50.1, 36, Math.sin(a) * 50.1), q4, new THREE.Vector3(1, 1, 1)); ribs.setMatrixAt(i, m4); ribs.setColorAt(i, c4) }
    ribs.frustumCulled = false; parent.add(ribs, new THREE.Mesh(stairGeo, railMat))
    const rim = new THREE.Mesh(rimGeo, railMat); rim.rotation.x = Math.PI / 2; rim.position.y = 72; parent.add(rim)
    for (const y of [18, 36, 54]) { const seam = new THREE.Mesh(seamGeo, seamMat); seam.rotation.x = Math.PI / 2; seam.position.y = y; parent.add(seam) }
  }
  dressTank(tank)
  const rays = new THREE.Group()
  for (let i = 0; i < 16; i++) {
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(-34, 240, 0), new THREE.Vector3(34, 240, 0)])
    const r = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: raw(PAPER.mustard), transparent: true, opacity: .34, side: THREE.DoubleSide, depthWrite: false }))
    r.rotation.z = (i / 16) * Math.PI * 2; rays.add(r)
  }
  rays.position.y = 42; tank.add(rays); scene.add(tank)
  const oldTank = new THREE.Group(), hinge = new THREE.Group(); oldTank.add(hinge)
  hinge.add(new THREE.Mesh(body.geometry, body.material).translateY(36), new THREE.Mesh(dome.geometry, dome.material))
  hinge.children[1].scale.y = .5; hinge.children[1].position.y = 45.4
  dressTank(hinge)
  const oldPad = new THREE.Mesh(ring.geometry, ring.material); oldPad.position.y = 1.5; oldTank.add(oldPad); scene.add(oldTank)

  // Paths
  const redPath = new Path(base.rail.ashmont)
  const station = (name) => base.stations.find((s) => s.name === name)
  const train = makeTrain(paper, quality)
  scene.add(train.group)
  const roadCars = makeCars(base.i93, paper, quality); if (roadCars) scene.add(roadCars.mesh)

  // Flags at Fields Corner
  const fc = station('Fields Corner')
  const dot = layers.food.filter((f) => /dorchester av/i.test(f.address || '') && Math.hypot(f.x - fc.x, f.y - fc.y) < 620).sort((a, b) => b.y - a.y)
  const picks = dot.length >= 3 ? [dot[0], dot[Math.floor(dot.length / 2)], dot[dot.length - 1]] : [{ x: fc.x + 190, y: fc.y + 150 }, { x: fc.x + 190, y: fc.y }, { x: fc.x + 190, y: fc.y - 150 }]
  const flags = picks.map((f) => makeFlag(f.x + 16, f.y)); flags.forEach((f) => scene.add(f.group))
  const focusCenter = picks.reduce((a, f) => [a[0] + f.x / picks.length, a[1] + f.y / picks.length], [0, 0])

  let time = 0
  return {
    renderer, scene, camera, base, redPath, station, focusCenter, flags, tank: { x: tx, y: ty, rays }, oldTank, updateDetail,
    setSize(w, h, pr) { renderer.setPixelRatio(pr); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix() },
    setReveal(x, y, r) { reveal.uReveal.value.set(x, y, r) },
    setCityColor(v) { buildingU.uColor.value = v },
    setFocus(x, y, r, a) { buildingU.uFocus.value.set(x, y, r, a) },
    setFog(v) { shared.uFog.value = v },
    setRing(x, y, r, a) { reveal.uRing.value.set(x, y, r, a) },
    placeOldTank(x, y, standing) { oldTank.position.set(x, LEVEL.main, -y); oldTank.visible = standing > -.5; hinge.visible = standing > .002; hinge.rotation.z = (1 - standing) * Math.PI / 2; hinge.position.x = -(1 - standing) * 18 },
    setTrain(distance, visible) { train.place(redPath, distance, visible) },
    setRays(a) { rays.visible = a > .01; rays.children.forEach((r) => { r.material.opacity = .34 * a }); rays.rotation.y = 0 },
    setFlags(k) { flags.forEach((f, i) => f.raise(Math.max(0, Math.min(1, k * 1.6 - i * .3)))) },
    render(dt, animate) {
      if (animate) { time += dt; waterMat.uniforms.uTime.value = time; flags.forEach((f) => { f.uniforms.uTime.value = time }); roadCars?.update(time) }
      const c = camera.position
      for (const s of shadowMeshes) { const bs = s.geometry.boundingSphere; s.visible = !quality.lite || bs.center.distanceTo(c) < 2300 }
      rays.lookAt(c.x, rays.getWorldPosition(new THREE.Vector3()).y, c.z)
      renderer.render(scene, camera)
    },
  }

  function makeFlag(x, y) {
    const c = document.createElement('canvas'); c.width = 192; c.height = 128; const g = c.getContext('2d')
    g.fillStyle = '#f6c915'; g.fillRect(0, 0, 192, 128); g.fillStyle = '#d6201f'; for (const yy of [46, 60, 74]) g.fillRect(0, yy, 192, 8)
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.NoColorSpace
    const uniforms = { uTime: { value: 0 }, uMap: { value: tex }, uRise: { value: 1 } }
    const geo = new THREE.PlaneGeometry(66, 44, 18, 6); geo.translate(33, 0, 0)
    const cloth = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: flagVert, fragmentShader: flagFrag, uniforms, side: THREE.DoubleSide }))
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.2, 112, 8), paper('#fff8e8')); pole.position.y = 56
    const group = new THREE.Group(); group.position.set(x, LEVEL.main, -y); group.add(pole, cloth)
    return { group, uniforms, raise(k) { group.visible = k > .001; pole.scale.y = Math.max(.01, k); pole.position.y = 56 * k; cloth.position.y = 22 + (86 * k); cloth.scale.setScalar(Math.max(.01, Math.min(1, k * 1.5))) } }
  }
}

function landMask(base) {
  const [x0, y0, x1, y1] = base.rect, size = 1200, c = document.createElement('canvas'); c.width = c.height = size
  const g = c.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#fff'
  const X = (x) => ((x - x0) / (x1 - x0)) * size, Y = (y) => ((y - y0) / (y1 - y0)) * size
  g.beginPath()
  for (const poly of base.main) for (const ring of poly) { for (let i = 0; i < ring.length; i += 2) i ? g.lineTo(X(ring[i]), Y(ring[i + 1])) : g.moveTo(X(ring[i]), Y(ring[i + 1])); g.closePath() }
  g.fill('evenodd'); const d = g.getImageData(0, 0, size, size).data
  return (x, y) => { const i = Math.floor(X(x)), j = Math.floor(Y(y)); return i >= 0 && j >= 0 && i < size && j < size && d[(j * size + i) * 4 + 3] > 128 }
}

function sheet(polys, bottom, top, material) {
  const pos = [], index = []
  for (const rings of polys) {
    const flat = [], holes = []
    rings.forEach((r, i) => { if (i) holes.push(flat.length / 2); flat.push(...r) })
    const start = pos.length / 3
    for (let i = 0; i < flat.length; i += 2) pos.push(flat[i], top, -flat[i + 1])
    for (const t of earcut(flat, holes)) index.push(start + t)
    for (const r of rings) {
      for (let i = 0; i < r.length; i += 2) {
        const j = (i + 2) % r.length, a = pos.length / 3
        pos.push(r[i], top, -r[i + 1], r[j], top, -r[j + 1], r[j], bottom, -r[j + 1], r[i], bottom, -r[i + 1])
        index.push(a, a + 1, a + 2, a, a + 2, a + 3)
      }
    }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(index)
  return new THREE.Mesh(g, material)
}

function addDropShadow(scene, polys, y, dx, dy) {
  const mat = new THREE.MeshBasicMaterial({ color: raw(PAPER.ink), transparent: true, opacity: .22, depthWrite: false, side: THREE.DoubleSide })
  const pos = [], index = []
  for (const rings of polys) { const flat = [], holes = []; rings.forEach((r, i) => { if (i) holes.push(flat.length / 2); flat.push(...r) }); const s = pos.length / 3; for (let i = 0; i < flat.length; i += 2) pos.push(flat[i] + dx, y, -(flat[i + 1] + dy)); for (const t of earcut(flat, holes)) index.push(s + t) }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(index); scene.add(new THREE.Mesh(g, mat))
}

function ribbonMesh(lines, width, inMain, material, lift) {
  const pos = [], index = [], hw = width / 2
  for (const f of lines) {
    if (!f) continue
    for (let i = 2; i < f.length; i += 2) {
      let ax = f[i - 2], ay = f[i - 1], bx = f[i], by = f[i + 1]; const mx = (ax + bx) / 2, my = (ay + by) / 2
      const l = Math.hypot(bx - ax, by - ay); if (l < .5) continue
      const ux = (bx - ax) / l, uy = (by - ay) / l, nx = -uy * hw, ny = ux * hw; ax -= ux * hw * .6; ay -= uy * hw * .6; bx += ux * hw * .6; by += uy * hw * .6
      const y = (inMain(mx, my) ? LEVEL.main : LEVEL.other) + lift, s = pos.length / 3
      pos.push(ax + nx, y, -(ay + ny), bx + nx, y, -(by + ny), bx - nx, y, -(by - ny), ax - nx, y, -(ay - ny)); index.push(s, s + 1, s + 2, s, s + 2, s + 3)
    }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(index)
  return new THREE.Mesh(g, material)
}

function buildTiles(d, quality) {
  const SIZE = 620, bins = new Map(); let c = 0
  for (let b = 0; b < d.count; b++) {
    const n = d.sides[b], pts = new Float32Array(n * 2); let x = d.xs[c], y = d.ys[c], sx = 0, sy = 0
    for (let i = 0; i < n; i++) { if (i) { x += d.xs[c + i]; y += d.ys[c + i] } pts[i * 2] = x / 2; pts[i * 2 + 1] = y / 2; sx += x / 2; sy += y / 2 }
    c += n; const cx = sx / n, cy = sy / n, key = `${Math.floor(cx / SIZE)}:${Math.floor(cy / SIZE)}`
    if (!bins.has(key)) bins.set(key, { p: [], c: [], m: [], i: [], items: [], ix: Math.floor(cx / SIZE), iy: Math.floor(cy / SIZE) })
    const t = bins.get(key), item = { p: pts, n, cx, cy, H: 3 + (d.heights[b] / 10) * 1.28, type: d.types[b], gable: !!(d.flags[b] & 1), seed: ((b * 2654435761) >>> 0) / 4294967296 }
    t.items.push(item); addBuilding(t, item, quality)
  }
  const out = []
  for (const t of bins.values()) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(t.p, 3)); g.setAttribute('aC', new THREE.Float32BufferAttribute(t.c, 2)); g.setAttribute('aM', new THREE.Float32BufferAttribute(t.m, 3)); g.setIndex(t.i); g.computeBoundingSphere(); g.boundingSphere.radius += 120
    out.push({ geometry: g, items: t.items, cx: (t.ix + .5) * SIZE, cy: (t.iy + .5) * SIZE, size: SIZE, detail: null })
  }
  return out
}

function addBuilding(t, b, quality) {
  const { p, n, cx, cy, H, type, seed } = b, at = t.p.length / 3
  const vert = (x, h, y) => { t.p.push(x, h, -y); t.c.push(cx, cy); t.m.push(type, seed, H) }
  let radius = 0; for (let i = 0; i < n; i++) radius += Math.hypot(p[i * 2] - cx, p[i * 2 + 1] - cy); radius = Math.max(1.5, radius / n)
  const ring = (scale, h) => { const s = t.p.length / 3; for (let i = 0; i < n; i++) vert(cx + (p[i * 2] - cx) * scale, h, cy + (p[i * 2 + 1] - cy) * scale); return s }
  const band = (a, c) => { for (let i = 0; i < n; i++) { const j = (i + 1) % n; t.i.push(a + i, a + j, c + j, a + i, c + j, c + i) } }
  if (b.gable && n === 4) {
    const E = H * .66, L = Math.hypot(p[2] - p[0], p[3] - p[1]) || 1, W = Math.hypot(p[6] - p[0], p[7] - p[1]) || 1, o = .8
    const ux = (p[2] - p[0]) / L, uy = (p[3] - p[1]) / L, vx = (p[6] - p[0]) / W, vy = (p[7] - p[1]) / W
    const base = ring(1, 0), eave = ring(1, E); band(base, eave)
    const m0 = [(p[0] + p[6]) / 2, (p[1] + p[7]) / 2], m1 = [(p[2] + p[4]) / 2, (p[3] + p[5]) / 2]
    const r = t.p.length / 3; vert(m0[0], H, m0[1]); vert(m1[0], H, m1[1]); t.i.push(eave + 1, eave + 2, r + 1, eave + 3, eave, r)
    const q = t.p.length / 3, off = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
    for (let i = 0; i < 4; i++) vert(p[i * 2] + (ux * off[i][0] + vx * off[i][1]) * o, E - .42, p[i * 2 + 1] + (uy * off[i][0] + vy * off[i][1]) * o)
    vert(m0[0] - ux * o, H + .3, m0[1] - uy * o); vert(m1[0] + ux * o, H + .3, m1[1] + uy * o)
    t.i.push(q, q + 1, q + 5, q, q + 5, q + 4, q + 2, q + 3, q + 4, q + 2, q + 4, q + 5); return
  }
  if ((type === 1 || type === 2) && n <= 12 && H < 18) {
    const E = H * .68, base = ring(1, 0), eave = ring(1, E); band(base, eave)
    const out = ring(1 + .75 / radius, E - .3), apex = t.p.length / 3; vert(cx, H + .2, cy)
    for (let i = 0; i < n; i++) t.i.push(out + i, out + (i + 1) % n, apex); return
  }
  const small = H < 6 || radius < 3.5, rings = []
  if (quality.lite || small) { rings.push(ring(1, 0), ring(1, H), ring(Math.max(.65, 1 - 1 / radius), H - .55)) }
  else { const k = 1 + .55 / radius; rings.push(ring(1, 0), ring(1, H - 1.15), ring(k, H - .95), ring(k, H), ring(Math.max(.62, 1 - 1.1 / radius), H - .75)) }
  for (let i = 1; i < rings.length; i++) band(rings[i - 1], rings[i])
  const top = rings[rings.length - 1], roof = earcut(Array.from(p))
  for (let i = 0; i < roof.length; i += 3) {
    const [a, c, e] = [roof[i], roof[i + 1], roof[i + 2]], area = (p[c * 2] - p[a * 2]) * (p[e * 2 + 1] - p[a * 2 + 1]) - (p[e * 2] - p[a * 2]) * (p[c * 2 + 1] - p[a * 2 + 1])
    if (area > 0) t.i.push(top + a, top + c, top + e); else t.i.push(top + a, top + e, top + c)
  }
}

function makeRoadIndex(lines) {
  const CELL = 90, map = new Map(), segs = []
  for (const f of lines) for (let i = 2; i < f.length; i += 2) {
    const s = [f[i - 2], f[i - 1], f[i], f[i + 1]], id = segs.push(s) - 1, steps = Math.ceil(Math.hypot(s[2] - s[0], s[3] - s[1]) / CELL)
    for (let k = 0; k <= steps; k++) { const x = s[0] + (s[2] - s[0]) * k / steps, y = s[1] + (s[3] - s[1]) * k / steps, key = `${Math.floor(x / CELL)}:${Math.floor(y / CELL)}`; if (!map.has(key)) map.set(key, new Set()); map.get(key).add(id) }
  }
  return {
    segs,
    distance(x, y) {
      let best = 90, cx = Math.floor(x / CELL), cy = Math.floor(y / CELL)
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const id of map.get(`${cx + a}:${cy + b}`) || []) {
        const s = segs[id], dx = s[2] - s[0], dy = s[3] - s[1], l = dx * dx + dy * dy || 1, k = Math.max(0, Math.min(1, ((x - s[0]) * dx + (y - s[1]) * dy) / l)), d = Math.hypot(x - s[0] - dx * k, y - s[1] - dy * k)
        if (d < best) best = d
      }
      return best
    },
  }
}

const CREAM = [1, .97, .88], SHADE = [.32, .39, .42], BRICKS = [.62, .25, .18], LEAF = [[.37, .61, .35], [.49, .68, .37], [.28, .5, .35], [.58, .72, .37]]
const ACCENT = [[.92, .67, .12], [.11, .5, .53], [.73, .26, .18], [.17, .3, .42]]

function buildDetail(tile, roads) {
  const P = [], C = [], M = [], RGB = [], I = []
  const vert = (x, h, y, o, rgb) => { P.push(x, h, -y); C.push(o.cx, o.cy); M.push(0, o.seed, o.H); RGB.push(rgb[0], rgb[1], rgb[2]) }
  function box(o, x, y, ux, uy, hl, hw, y0, y1, rgb, back = y1) {
    const vx = -uy, vy = ux, s = P.length / 3, c = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
    for (const [a, b] of c) vert(x + ux * hl * a + vx * hw * b, y0, y + uy * hl * a + vy * hw * b, o, rgb)
    for (const [a, b] of c) vert(x + ux * hl * a + vx * hw * b, b < 0 ? y1 : back, y + uy * hl * a + vy * hw * b, o, rgb)
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; I.push(s + i, s + j, s + 4 + j, s + i, s + 4 + j, s + 4 + i) }
    I.push(s + 4, s + 5, s + 6, s + 4, s + 6, s + 7)
  }
  function tree(x, y, seed) {
    const o = { cx: x, cy: y, seed, H: 12 }, g = LEAF[Math.floor(seed * 4)], h = 7 + seed * 5, r = 3.3 + seed * 1.8
    box(o, x, y, 1, 0, .38, .38, 0, h * .55, [.45, .33, .24]); const s = P.length / 3
    vert(x, h + r * .95, y, o, g); for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3 + seed * 3; vert(x + Math.cos(a) * r, h, y + Math.sin(a) * r, o, g) } vert(x, h - r * .75, y, o, [g[0] * .8, g[1] * .8, g[2] * .8])
    for (let i = 0; i < 6; i++) { const j = (i + 1) % 6; I.push(s, s + 1 + i, s + 1 + j, s + 7, s + 1 + j, s + 1 + i) }
  }
  function frontEdge(b, wantShort) {
    let best = null; const { p, n } = b
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, ax = p[i * 2], ay = p[i * 2 + 1], bx = p[j * 2], by = p[j * 2 + 1], L = Math.hypot(bx - ax, by - ay); if (L < 3.5) continue
      const mx = (ax + bx) / 2, my = (ay + by) / 2, ux = (bx - ax) / L, uy = (by - ay) / L, nx = uy, ny = -ux, d = roads.distance(mx + nx * 2, my + ny * 2), score = d + (wantShort ? L * .35 : -L * .22)
      if (!best || score < best.score) best = { score, mx, my, ux, uy, nx, ny, L, d }
    }
    return best
  }
  for (const b of tile.items) {
    const { H, type, seed, n, p, cx, cy } = b, accent = ACCENT[Math.floor(seed * 4)]
    if (type === 3 && n <= 10) {
      const e = frontEdge(b, true); if (!e || e.L < 4) continue
      const hl = Math.min(e.L * .43, 4.4), D = 2.5, out = D / 2, mx = e.mx + e.nx * out, my = e.my + e.ny * out, floors = Math.max(2, Math.min(3, Math.round(H / 4.1))), fh = (H - 1.2) / floors
      for (let f = 0; f < floors; f++) {
        const y = f * fh + .55; box(b, mx, my, e.ux, e.uy, hl, out, y, y + .28, CREAM)
        box(b, e.mx + e.nx * (D - .08), e.my + e.ny * (D - .08), e.ux, e.uy, hl, .08, y + .28, y + 1.15, accent)
      }
      box(b, mx, my, e.ux, e.uy, hl + .25, out + .2, H - 1.05, H - .72, CREAM)
      for (const k of [-1, 0, 1]) box(b, e.mx + e.nx * (D - .08) + e.ux * hl * k, e.my + e.ny * (D - .08) + e.uy * hl * k, e.ux, e.uy, .17, .17, 0, H - 1, CREAM)
    } else if (type === 1 || type === 2) {
      if (b.gable) { const m = .22 + seed * .5, x = p[0] + (p[2] - p[0]) * m + (p[6] - p[0]) * .5, y = p[1] + (p[3] - p[1]) * m + (p[7] - p[1]) * .5; box(b, x, y, 1, 0, .55, .55, H * .55, H + 1.25, BRICKS) }
      const e = frontEdge(b, true)
      if (e && e.d < 34) {
        const hl = Math.min(e.L * .34, 2.7), out = .95, mx = e.mx + e.nx * out, my = e.my + e.ny * out
        box(b, mx, my, e.ux, e.uy, hl, out, 0, .55, [.82, .78, .68]); box(b, mx, my, e.ux, e.uy, hl + .2, out + .15, 3.05, 3.15, accent, 3.75)
        for (const k of [-1, 1]) box(b, e.mx + e.nx * 1.75 + e.ux * hl * k, e.my + e.ny * 1.75 + e.uy * hl * k, e.ux, e.uy, .12, .12, .5, 3.1, CREAM)
        box(b, e.mx + e.nx * .03, e.my + e.ny * .03, e.ux, e.uy, .55, .05, .55, 2.7, SHADE)
      }
    } else if (type === 5) {
      const e = frontEdge(b, false)
      if (e && e.L > 5) {
        const hl = Math.min(e.L * .44, 11), stripe = Math.max(2, Math.floor(hl / 1.25))
        for (let i = 0; i < stripe; i++) { const k = ((i + .5) / stripe) * 2 - 1, c = i % 2 ? CREAM : accent; box(b, e.mx + e.nx * .85 + e.ux * hl * k, e.my + e.ny * .85 + e.uy * hl * k, e.ux, e.uy, hl / stripe, .85, 3.2, 3.32, c, 4) }
        box(b, e.mx + e.nx * .06, e.my + e.ny * .06, e.ux, e.uy, hl * .86, .08, 4.15, Math.min(5.15, H - .3), accent)
      }
    } else if (type === 4 && H > 8) {
      box(b, cx, cy, 1, 0, 1.6, 1.25, H - .8, H + 1.4, [.87, .82, .7]); if (seed > .55) box(b, cx + 3, cy - 1.5, 1, 0, .9, .9, H - .8, H + 2.4, [.55, .38, .28])
    } else if (type === 6) {
      const e = frontEdge(b, false)
      if (e && e.L > 9) {
        const hl = Math.min(e.L * .2, 5), D = 2.2; box(b, e.mx + e.nx * D / 2, e.my + e.ny * D / 2, e.ux, e.uy, hl + .3, D / 2 + .2, Math.min(H - 1, 4.8), Math.min(H - .55, 5.4), CREAM)
        for (const k of [-1, -.34, .34, 1]) box(b, e.mx + e.nx * D + e.ux * hl * k, e.my + e.ny * D + e.uy * hl * k, e.ux, e.uy, .2, .2, 0, Math.min(H - 1, 4.8), CREAM)
      }
    }
  }
  const half = tile.size / 2; let made = 0
  for (const s of roads.segs) {
    const mx = (s[0] + s[2]) / 2, my = (s[1] + s[3]) / 2; if (Math.abs(mx - tile.cx) > half + 80 || Math.abs(my - tile.cy) > half + 80) continue
    const L = Math.hypot(s[2] - s[0], s[3] - s[1]); if (L < 18) continue
    const ux = (s[2] - s[0]) / L, uy = (s[3] - s[1]) / L
    for (let d = 10; d < L - 6 && made < 230; d += 31) {
      const r = Math.abs(Math.sin(s[0] * 12.9 + s[1] * 78.2 + d * 3.1)) ; if (r < .42) continue
      const side = r > .71 ? 1 : -1, x = s[0] + ux * d - uy * side * 7.2, y = s[1] + uy * d + ux * side * 7.2
      if (Math.abs(x - tile.cx) > half || Math.abs(y - tile.cy) > half) continue
      if (tile.items.some((b) => Math.hypot(b.cx - x, b.cy - y) < 8.5)) continue
      tree(x, y, r); made++
    }
  }
  if (!P.length) return null
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('aC', new THREE.Float32BufferAttribute(C, 2)); g.setAttribute('aM', new THREE.Float32BufferAttribute(M, 3)); g.setAttribute('aRGB', new THREE.Float32BufferAttribute(RGB, 3)); g.setIndex(I); g.computeBoundingSphere(); return g
}

function makeTrain(paper) {
  const group = new THREE.Group(), cars = []
  const body = new THREE.BoxGeometry(14, 13, 66); body.translate(0, 8.5, 0)
  const stripe = new THREE.BoxGeometry(14.5, 3.6, 66.5); stripe.translate(0, 8, 0)
  const roof = new THREE.BoxGeometry(10.5, 2, 58); roof.translate(0, 16, 0)
  const win = new THREE.BoxGeometry(14.8, 3.2, 8)
  const bodyM = paper('#fff8e8'), stripeM = paper(PAPER.red), roofM = paper('#c4382b'), winM = paper(PAPER.ink)
  for (let i = 0; i < 4; i++) {
    const car = new THREE.Group(); car.add(new THREE.Mesh(body, bodyM), new THREE.Mesh(stripe, stripeM), new THREE.Mesh(roof, roofM))
    for (let w = -2; w <= 2; w++) { const glass = new THREE.Mesh(win, winM); glass.position.set(0, 11.8, w * 12.5); car.add(glass) }
    group.add(car); cars.push(car)
  }
  const a = {}, b = {}
  return { group, place(path, distance, visible) {
    group.visible = visible
    cars.forEach((car, i) => {
      const s = distance - i * 72; path.at(s + 30, a); path.at(s - 30, b); const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2
      car.position.set(x, LEVEL.main + 1.6, -y); car.rotation.y = Math.atan2(a.x - b.x, -(a.y - b.y))
    })
  } }
}

function makeCars(lines, paper, quality) {
  const paths = lines.map((l) => new Path(l)).sort((a, b) => b.length - a.length).slice(0, 8).filter((p) => p.length > 400)
  if (!paths.length) return null
  const count = quality.lite ? 34 : 70, g = new THREE.BoxGeometry(7, 5, 15); g.translate(0, 4, 0)
  const mesh = new THREE.InstancedMesh(g, paper('#ffffff'), count); mesh.frustumCulled = false
  const palette = ['#b9432e', '#ebaa1f', '#17324a', '#fff8e8', '#46aaa5'], c = new THREE.Color()
  for (let i = 0; i < count; i++) mesh.setColorAt(i, c.copy(raw(palette[i % 5])))
  const o = new THREE.Object3D(), a = {}
  function update(t) {
    for (let i = 0; i < count; i++) {
      const p = paths[i % paths.length], speed = 34 + (i % 5) * 4, s = ((i * 317.7 + t * speed) % p.length + p.length) % p.length
      p.at(s, a); o.position.set(a.x, LEVEL.main + .8, -a.y); o.rotation.y = Math.atan2(a.dx, -a.dy); o.updateMatrix(); mesh.setMatrixAt(i, o.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  }
  update(0); return { mesh, update }
}
