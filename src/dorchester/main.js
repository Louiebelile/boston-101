import '@fontsource/caprasimo/400.css'
import '@fontsource/atkinson-hyperlegible/400.css'
import '@fontsource/atkinson-hyperlegible/700.css'
import './lesson.css'
import * as THREE from 'three'
import { loadJsonPak, loadPak } from './data.js'
import { createWorld } from './world.js'
import { CARDS, END, STOPS, createDirector } from './story.js'

const $ = (id) => document.getElementById(id)
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
const lite = matchMedia('(max-width: 820px)').matches || (navigator.hardwareConcurrency || 8) <= 4
const dataRoot = new URL('../data/dorchester/', import.meta.url)

const story = $('story')
const cards = CARDS.map((c) => { const el = document.createElement('article'); el.className = `card ${c.kind}`; el.innerHTML = c.html; story.append(el); return { ...c, el, shown: null } })
const route = $('route'); const stops = STOPS.map((s) => { const li = document.createElement('li'); li.textContent = s; route.append(li); return li })
$('scroll').style.height = `${(END + 1) * 100}svh`
const img = $('photo').querySelector('img'); img.src = new URL('../img/gas-tank.png', import.meta.url).href

function staticFallback(message) { document.documentElement.classList.add('no-3d'); $('loading').hidden = true; if (message) console.warn(message) }

try {
  const [base, buildings, layers] = await Promise.all([loadJsonPak(new URL('base.pak', dataRoot)), loadPak(new URL('buildings.pak', dataRoot)), loadJsonPak(new URL('layers.pak', dataRoot))])
  $('loading').querySelector('i').style.width = '70%'
  await new Promise((r) => setTimeout(r, 30))
  const world = createWorld($('city'), base, buildings, layers, { lite })
  const direct = createDirector(world)
  const signs = ['JFK/UMass', 'Savin Hill', 'Fields Corner'].map((name) => {
    const s = world.station(name), el = document.createElement('span'); el.textContent = name; $('signs').append(el)
    return { el, v: new THREE.Vector3(s.x, 62, -s.y) }
  })
  let pr = Math.min(devicePixelRatio || 1, lite ? 1.6 : 2)
  const size = () => world.setSize(innerWidth, innerHeight, pr); addEventListener('resize', size); size()
  let shown = -1, last = performance.now(), slow = 0, frames = 0, skip = 0
  const v = new THREE.Vector3(), forward = new THREE.Vector3(), sky = document.querySelector('.sky')
  const target = () => Math.min(END + .9, scrollY / innerHeight)
  shown = target()
  function frame(now) {
    requestAnimationFrame(frame)
    const dt = Math.min(.1, (now - last) / 1000), goal = target(), moving = Math.abs(goal - shown) > .0006
    if (!moving && !reduced && ++skip % 3) return
    last = now
    shown = reduced ? goal : shown + (goal - shown) * (1 - Math.exp(-dt * 7))
    const s = direct(shown)
    for (const c of cards) {
      const fade = Math.min(1, Math.min((shown - c.from) / .16, (c.to - shown) / .16)), on = Math.max(0, fade)
      if (on !== c.shown) { c.shown = on; c.el.style.setProperty('--v', on.toFixed(3)); c.el.classList.toggle('live', on > .02); c.el.inert = on < .5 }
    }
    $('doors').style.setProperty('--d', s.doors.toFixed(3)); $('doors').style.visibility = s.doors > .001 ? 'visible' : 'hidden'
    $('photo').style.opacity = s.photo.toFixed(3); $('photo').style.visibility = s.photo > .001 ? 'visible' : 'hidden'; $('photo').style.setProperty('--z', (1.08 - s.photo * .08 + (shown - 5.1) * .012).toFixed(4))
    route.classList.toggle('on', s.routeOn); stops.forEach((el, i) => { el.classList.toggle('here', i === s.stopIndex); el.classList.toggle('done', i < s.stopIndex) })
    world.render(dt, !reduced)
    world.camera.updateMatrixWorld()
    for (const x of signs) {
      v.copy(x.v).project(world.camera); const d = world.camera.position.distanceTo(x.v), ok = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05 && shown > 8.6 && shown < 16.8 && d < 1700
      x.el.style.opacity = ok ? 1 : 0; if (ok) x.el.style.transform = `translate(${(v.x + 1) * innerWidth / 2}px, ${(1 - v.y) * innerHeight / 2}px) translate(-50%,-100%)`
    }
    world.camera.getWorldDirection(forward); forward.y = 0; forward.normalize(); v.copy(world.camera.position).addScaledVector(forward, 30000).setY(0).project(world.camera)
    sky.style.setProperty('--h', `${((1 - v.y) / 2 * 100).toFixed(2)}%`)
    if (moving && !lite) { frames++; slow += dt; if (frames === 50) { if (slow / 50 > .036 && pr > 1) { pr = Math.max(1, pr - .35); size() } frames = 0; slow = 0 } }
  }
  document.documentElement.classList.add('ready'); $('loading').hidden = true; window.__ready = true
  requestAnimationFrame(frame)
} catch (error) { staticFallback(error) }
