import * as THREE from 'three'
import earcut from 'earcut'
import { parseBuildings, Path } from './data.js'
import { PAPER, buildingVert, buildingFrag, shadowVert, shadowFrag, paperVert, paperFrag, waterVert, waterFrag, flagVert, flagFrag } from './shaders.js'

const raw = (hex) => { const c = new THREE.Color(); c.setStyle(hex, THREE.LinearSRGBColorSpace); return c }

export const LEVEL = { water: 0, other: 5, main: 12, park: 12.8 }

export function createWorld(canvas, base, buildingBuffer, layers, quality) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !quality.lite, alpha: true, stencil: true, powerPreference: 'high-performance' })
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace
  renderer.setClearColor(0x000000, 0)
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(34, 1, 6, 42000)
  const shared = { uSky: { value: raw(PAPER.sky) }, uFog: { value: 14000 }, uCam: { value: camera.position } }
  const reveal = { uReveal: { value: new THREE.Vector3(0, 0, 0) }, uSoft: { value: 420 } }
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
  const tiles = buildTiles(parseBuildings(buildingBuffer), quality)
  const shadowMeshes = []
  for (const g of tiles) {
    const b = new THREE.Mesh(g, buildingMat); b.frustumCulled = true; b.renderOrder = 2; scene.add(b)
    const s = new THREE.Mesh(g, shadowMat); s.renderOrder = 1; scene.add(s); shadowMeshes.push(s)
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
  const rays = new THREE.Group()
  for (let i = 0; i < 16; i++) {
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(-34, 240, 0), new THREE.Vector3(34, 240, 0)])
    const r = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: raw(PAPER.mustard), transparent: true, opacity: .34, side: THREE.DoubleSide, depthWrite: false }))
    r.rotation.z = (i / 16) * Math.PI * 2; rays.add(r)
  }
  rays.position.y = 42; tank.add(rays); scene.add(tank)

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
    renderer, scene, camera, base, redPath, station, focusCenter, flags, tank: { x: tx, y: ty, rays },
    setSize(w, h, pr) { renderer.setPixelRatio(pr); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix() },
    setReveal(x, y, r) { reveal.uReveal.value.set(x, y, r) },
    setCityColor(v) { buildingU.uColor.value = v },
    setFocus(x, y, r, a) { buildingU.uFocus.value.set(x, y, r, a) },
    setFog(v) { shared.uFog.value = v },
    setTrain(distance, visible) { train.place(redPath, distance, visible) },
    setRays(a) { rays.visible = a > .01; rays.children.forEach((r) => { r.material.opacity = .34 * a }); rays.rotation.y = 0 },
    setFlags(k) { flags.forEach((f, i) => f.raise(Math.max(0, Math.min(1, k * 1.6 - i * .3)))) },
    render(dt, animate) {
      if (animate) { time += dt; waterMat.uniforms.uTime.value = time; flags.forEach((f) => { f.uniforms.uTime.value = time }); roadCars?.update(time) }
      const c = camera.position
      for (const s of shadowMeshes) { const bs = s.geometry.boundingSphere; s.visible = !quality.lite || bs.center.distanceTo(c) < 2100 }
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
    const n = d.sides[b]; const pts = new Float32Array(n * 2); let x = d.xs[c], y = d.ys[c], sx = 0, sy = 0
    for (let i = 0; i < n; i++) { if (i) { x += d.xs[c + i]; y += d.ys[c + i] } pts[i * 2] = x / 2; pts[i * 2 + 1] = y / 2; sx += x / 2; sy += y / 2 }
    c += n; const cx = sx / n, cy = sy / n, key = `${Math.floor(cx / SIZE)}:${Math.floor(cy / SIZE)}`
    if (!bins.has(key)) bins.set(key, { p: [], c: [], m: [], i: [] })
    addBuilding(bins.get(key), pts, cx, cy, d.heights[b] / 10, d.types[b], d.flags[b] & 1, ((b * 2654435761) >>> 0) / 4294967296, quality)
  }
  const out = []
  for (const t of bins.values()) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(t.p, 3)); g.setAttribute('aC', new THREE.Float32BufferAttribute(t.c, 2)); g.setAttribute('aM', new THREE.Float32BufferAttribute(t.m, 2)); g.setIndex(t.i); g.computeBoundingSphere(); g.boundingSphere.radius += 90; out.push(g)
  }
  return out
}

function addBuilding(t, p, cx, cy, height, type, gable, seed, quality) {
  const n = p.length / 2, H = 3 + height * 1.28, at = t.p.length / 3
  const vert = (x, h, y) => { t.p.push(x, h, -y); t.c.push(cx, cy); t.m.push(type, seed) }
  if (gable && n === 4) {
    const E = H * .68
    for (let i = 0; i < 4; i++) vert(p[i * 2], 0, p[i * 2 + 1])
    for (let i = 0; i < 4; i++) vert(p[i * 2], E, p[i * 2 + 1])
    vert((p[6] + p[0]) / 2, H, (p[7] + p[1]) / 2); vert((p[2] + p[4]) / 2, H, (p[3] + p[5]) / 2)
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; t.i.push(at + i, at + j, at + 4 + j, at + i, at + 4 + j, at + 4 + i) }
    t.i.push(at + 4, at + 5, at + 9, at + 4, at + 9, at + 8, at + 6, at + 7, at + 8, at + 6, at + 8, at + 9, at + 7, at + 4, at + 8, at + 5, at + 6, at + 9)
    return
  }
  for (let i = 0; i < n; i++) vert(p[i * 2], 0, p[i * 2 + 1])
  for (let i = 0; i < n; i++) vert(p[i * 2], H, p[i * 2 + 1])
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; t.i.push(at + i, at + j, at + n + j, at + i, at + n + j, at + n + i) }
  const roof = earcut(Array.from(p))
  for (let i = 0; i < roof.length; i += 3) {
    const [a, b, c] = [roof[i], roof[i + 1], roof[i + 2]]
    const area = (p[b * 2] - p[a * 2]) * (p[c * 2 + 1] - p[a * 2 + 1]) - (p[c * 2] - p[a * 2]) * (p[b * 2 + 1] - p[a * 2 + 1])
    if (area > 0) t.i.push(at + n + a, at + n + b, at + n + c); else t.i.push(at + n + a, at + n + c, at + n + b)
  }
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
