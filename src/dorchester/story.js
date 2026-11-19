export const PHOTO = null
export const STOPS = ['JFK/UMass', 'Savin Hill', 'Fields Corner']
export const END = 17.6

const dot = '<svg class="dot" viewBox="0 0 120 150" aria-hidden="true"><use href="#dot"/></svg>'
const card = (from, to, html, kind = 'say') => ({ from, to, kind, html })

export const CARDS = [
  card(-1, .72, `<p class="kicker-free">A ride through Boston's biggest neighborhood</p><h1>Dorchester is many places in one.</h1><p class="scroll-cue">Keep scrolling to board</p>`, 'title'),
  card(2.55, 3.65, `${dot}<h2>I'm Dot, your conductor.</h2><p>You've probably met Dorchester from I-93, at about 60 miles an hour. Let's fix that.</p>`),
  card(3.95, 5, `${dot}<h2>You know this one.</h2><p>In 1971, Boston Gas hired artist Corita Kent to paint a gas tank here. Drivers have used it as a landmark ever since.</p>`),
  card(5.45, 6.8, `${dot}<h2>Here's the twist.</h2><p>This isn't the tank she painted. That one stood right next door. It came down in 1992, and her design moved here.</p>`),
  card(7.25, 8.3, `${dot}<h2>It still has a day job.</h2><p>From November to March, this tank helps supply gas when the region needs it most.</p>`),
  card(8.65, 9.2, `${dot}<h2>All aboard at JFK/UMass.</h2><p>The highway only shows you the edge. The train takes you in.</p>`),
  card(10.1, 11.1, `${dot}<h2>Next stop, Savin Hill.</h2><p>Savin Hill had a train station back in 1845. Red Line service arrived here in 1927.</p>`),
  card(11.5, 12.5, `${dot}<h2>Every stop is its own place.</h2><p>Dorchester grew up as a collection of villages, squares and corners. You can still feel that from the train.</p>`),
  card(13.1, 14.05, `${dot}<h2>Fields Corner.</h2><p>Step off here and you're in Boston Little Saigon, home to 75% of the city's Vietnamese Americans.</p>`),
  card(14.5, 15.55, `${dot}<h2>See the yellow flags?</h2><p>That's the flag of South Vietnam. Many families here came as refugees after the war, and it still flies along Dorchester Avenue.</p>`),
  card(15.85, 16.6, `${dot}<h2>More than 200 places to stop.</h2><p>Shops, services and restaurants fill this one district. And that's only one corner of Dorchester.</p>`),
  card(16.85, 99, `<h2>That was one stop.</h2><p>The full ride continues to the people, work, schools, leaders and food that make Dorchester many places in one.</p>
    <details><summary>Sources</summary><ul>
      <li><a href="https://www.dotnews.com/node/179290">Dorchester Reporter on the gas tank</a></li>
      <li><a href="https://en.wikipedia.org/wiki/Savin_Hill_station">Savin Hill station history</a></li>
      <li><a href="https://www.dotnews.com/?p=35382">Dorchester Reporter on its villages</a></li>
      <li><a href="https://www.wbur.org/bostonomix/2019/12/08/boston-dorchester-little-saigon-designation">WBUR on Little Saigon</a></li>
      <li><a href="https://www.boston.gov/departments/arts-and-culture/boston-little-saigon-cultural-district">City of Boston: Boston Little Saigon</a></li>
      <li><a href="https://www.wgbh.org/news/local/2025-04-30/50-years-later-bostons-vietnamese-community-honors-those-who-re-rooted-here">GBH on Boston's Vietnamese community</a></li>
      <li>Map data: City of Boston, MassGIS and OpenStreetMap contributors</li>
    </ul></details><p class="credit">Made by Louie Belile</p>`, 'end'),
]

const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * t * (t * (t * 6 - 15) + 10) }
const mix = (a, b, k) => a + (b - a) * k
const W = (x, north, y) => [x, y, -north]

export function createDirector(world) {
  const { base, redPath } = world
  const [tx, ty] = base.tank
  let hw = [tx - 300, ty], best = Infinity
  for (const l of base.i93) for (let i = 0; i < l.length; i += 2) { const d = Math.hypot(l[i] - tx, l[i + 1] - ty); if (d < best) { best = d; hw = [l[i], l[i + 1]] } }
  const dl = Math.hypot(tx - hw[0], ty - hw[1]) || 1, dx = (tx - hw[0]) / dl, dy = (ty - hw[1]) / dl, px = -dy, py = dx
  const ox = px * 175 + dx * 30, oy = py * 175 + dy * 30
  const J = world.station('JFK/UMass'), F = world.station('Fields Corner'), S = world.station('Savin Hill')
  const sJ = redPath.nearest(J.x, J.y), sF = redPath.nearest(F.x, F.y)
  const C = world.focusCenter
  const keys = [
    [0, W(1100, -7700, 5700), W(-1150, -420, 0)],
    [1.7, W(2600, -5400, 2750), W(700, 250, 0)],
    [2.35, W(1750, -1900, 420), W(800, -150, 10)],
    [3.05, W(hw[0] - dx * 300 + px * 90, hw[1] - dy * 300 + py * 90, 92), W(tx - dx * 40, ty - dy * 40, 34)],
    [4.45, W(tx - dx * 310 + px * 150, ty - dy * 310 + py * 150, 74), W(tx, ty, 62)],
    [6.1, W(tx - dx * 390 - px * 130, ty - dy * 390 - py * 130, 112), W(tx + ox * .45, ty + oy * .45, 44)],
    [7.8, W(tx + 800, ty - 560, 210), W(tx - 360, ty + 240, 30)],
    [8.95, W(J.x + 250, J.y - 300, 150), W(J.x, J.y, 16)],
  ]
  const after = [
    [13.5, W(F.x - 310, F.y - 370, 205), W(C[0] - 30, C[1], 18)],
    [15, W(C[0] - 150, C[1] - 245, 58), W(C[0], C[1], 76)],
    [16.2, W(C[0] + 300, C[1] - 520, 250), W(C[0], C[1] + 40, 24)],
    [17.3, W(1900, -4600, 2500), W(380, 360, 0)],
  ]
  const a = {}, b = {}
  const trainS = (T) => mix(sJ - 40, sF, sm(9.75, 12.85, T))
  function chase(T) {
    const s = trainS(T); redPath.at(s + 40, a); redPath.at(s - 40, b); const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2, ux = (a.x - b.x) / 80, uy = (a.y - b.y) / 80
    const side = -(Math.sin(T * .55) * 25 + 92)
    return [W(x - ux * 285 + uy * side * .95, y - uy * 285 - ux * side * .95, 96), W(x + ux * 95, y + uy * 95, 8)]
  }
  function track(list, T) {
    let i = 0; while (i < list.length - 2 && T > list[i + 1][0]) i++
    const A = list[i], B = list[i + 1], k = sm(A[0], B[0], T)
    return [A[1].map((v, n) => mix(v, B[1][n], k)), A[2].map((v, n) => mix(v, B[2][n], k))]
  }
  return (T, budget = 7) => {
    let shot
    if (T < 9.3) shot = track(keys, T)
    else if (T < 12.85) shot = chase(T)
    else shot = track([[12.85, ...chase(12.85)], ...after], T)
    if (T >= 8.95 && T < 9.3) shot = chase(T)
    world.camera.position.set(...shot[0]); world.camera.lookAt(...shot[1])
    const h = shot[0][1]; world.camera.near = Math.max(6, h * .22); world.camera.far = 42000; world.camera.updateProjectionMatrix()
    world.setFog(Math.max(3600, h * 5.6)); world.updateDetail(shot[1][0], -shot[1][2], budget)
    world.setReveal(-2800, -600, Math.max(0, 500 + 1740 * (T - .45))); world.setCityColor(.86 * sm(1.1, 2.75, T))
    const f = sm(13, 14.3, T) * (1 - .35 * sm(16.5, 17.3, T)); world.setFocus(C[0], C[1], mix(90, 620, sm(13, 16.2, T)), f)
    world.setRays(sm(3.3, 4.1, T) * (1 - sm(4.6, 4.95, T)) + sm(6.45, 6.9, T) * (1 - sm(7.3, 8, T)))
    world.placeOldTank(tx + ox, ty + oy, T < 4.9 || T > 7 ? -1 : sm(4.95, 5.35, T) * (1 - sm(5.95, 6.55, T)))
    const riding = sm(9.75, 10.1, T) * (1 - sm(12.45, 12.85, T)); redPath.at(trainS(T), a)
    if (T < 13) world.setRing(a.x, a.y, 70, riding); else world.setRing(F.x, F.y, (T - 13) * 700, 1 - sm(13.6, 14.3, T))
    world.setFlags(sm(14.15, 15.05, T)); world.setTrain(trainS(T), T > 8.2)
    return { doors: T < 9.75 ? sm(8.95, 9.28, T) * (1 - sm(9.42, 9.75, T)) : 0, photo: 0, stopIndex: T < 10.5 ? 0 : T < 12 ? 1 : 2, routeOn: T > 9.1 && T < 16.7 }
  }
}
