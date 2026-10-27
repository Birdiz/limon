import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { handrailOutline, postOutline, railOutline } from "../cnc/railing";
import type { Essence } from "../core/params";
import type { StringerPiece, Stair, Tread } from "../core/stair";
import { stringerOutline } from "../core/stringer";
import { V, type Pt } from "../core/vec";
import { cssVar } from "./dom";

/* Le plan (x, y) devient (x, -z) en 3D, la hauteur est y.
   Rendu calé sur l'ancien Three.js r147 : couleurs sans gestion d'espace colorimétrique,
   intensités multipliées par π depuis la suppression des lumières « legacy ». */
THREE.ColorManagement.enabled = false;

const ESS: Record<Essence, number> = {
  chene: 0xc4955f,
  hetre: 0xdcae80,
  frene: 0xe2c79f,
  sapin: 0xe6c78c,
  noyer: 0x80583a,
};

/** Générateur pseudo-aléatoire (mulberry32), pour un veinage identique à chaque chargement. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeWoodTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const x = c.getContext("2d")!,
    r = rng(7);
  x.fillStyle = "#fff";
  x.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 170; i++) {
    const y = r() * 512,
      a = 0.03 + r() * 0.09,
      ph = r() * 6;
    x.strokeStyle = `rgba(70,40,15,${a})`;
    x.lineWidth = 0.5 + r() * 2.4;
    x.beginPath();
    for (let X = 0; X <= 512; X += 8) {
      const yy = y + Math.sin((X / 512) * Math.PI * 2 + ph) * 5 + Math.sin((X / 512) * Math.PI * 8 + ph * 2) * 1.2;
      if (X) x.lineTo(X, yy);
      else x.moveTo(X, yy);
    }
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / 700, 1 / 700);
  t.anisotropy = 4;
  return t;
}

const v2 = (arr: readonly Pt[]) => arr.map((q) => new THREE.Vector2(q[0], q[1]));

function shaded(geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}

/** Contour du plan extrudé vers le haut depuis z0. */
function extrudePlan(poly: readonly Pt[], z0: number, depth: number, mat: THREE.Material): THREE.Mesh {
  const geo = new THREE.ExtrudeGeometry(new THREE.Shape(v2(poly)), { depth, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, z0, 0);
  return shaded(geo, mat);
}

/** Nez arrondi : profil (v vers l'arrière de la marche, z) extrudé le long de la ligne de nez. */
function noseMesh(n: NonNullable<Tread["nose"]>, z0: number, et: number, r: number, mat: THREE.Material): THREE.Mesh {
  const pts: Pt[] = [],
    k = 8,
    flat = et - 2 * r > 0.01;
  for (let i = 0; i <= k; i++) {
    const a = -Math.PI / 2 - ((Math.PI / 2) * i) / k;
    pts.push([r + r * Math.cos(a), r + r * Math.sin(a)]);
  }
  for (let i = flat ? 0 : 1; i <= k; i++) {
    const a = Math.PI - ((Math.PI / 2) * i) / k;
    pts.push([r + r * Math.cos(a), et - r + r * Math.sin(a)]);
  }
  const geo = new THREE.ExtrudeGeometry(new THREE.Shape(v2(pts)), { depth: n.len, bevelEnabled: false });
  const X = new THREE.Vector3(n.nr[0], 0, -n.nr[1]),
    Y = new THREE.Vector3(0, 1, 0),
    Z = new THREE.Vector3(n.nr[1], 0, n.nr[0]);
  geo.applyMatrix4(new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(n.o[0], z0, -n.o[1]));
  return shaded(geo, mat);
}

/** Contour (u, z) d'un plan vertical, extrudé sur width le long de rn depuis origin. */
function sideMesh(outline: readonly Pt[], origin: Pt, dir: Pt, rn: Pt, width: number, mat: THREE.Material): THREE.Mesh {
  const geo = new THREE.ExtrudeGeometry(new THREE.Shape(v2(outline)), { depth: width, bevelEnabled: false });
  const X = new THREE.Vector3(dir[0], 0, -dir[1]),
    Y = new THREE.Vector3(0, 1, 0),
    Z = new THREE.Vector3(rn[0], 0, -rn[1]);
  geo.applyMatrix4(new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(origin[0], 0, -origin[1]));
  return shaded(geo, mat);
}

const stringerMesh = (sp: StringerPiece, mat: THREE.Material): THREE.Mesh =>
  sideMesh(stringerOutline(sp, sp.hl), sp.origin, sp.dir, sp.rn, sp.width, mat);

/** Garde-corps : chaque pièce dans le plan vertical de son tronçon de limon de jour. */
function railingMeshes(R: Stair, mat: THREE.Material): THREE.Mesh[] {
  const G = R.rail,
    p = R.params;
  if (!G) return [];
  const sp = (idx: number) => R.stringers.find((s) => s.side === "in" && s.idx === idx)!;
  const at = (idx: number, w: number) => {
    const s = sp(idx);
    return [V.add(s.a, V.mul(s.rn, G.off - w / 2)), s.dir, s.rn] as const;
  };
  return [
    ...G.handrails.map((hr) => sideMesh(handrailOutline(hr), ...at(hr.idx, p.mcL), p.mcL, mat)),
    ...G.posts.map((q) => sideMesh(postOutline(q, p), ...at(q.idx, p.bs), p.bs, mat)),
    ...G.rails.map((r) => sideMesh(railOutline(r), ...at(r.idx, p.bs), p.bs, mat)),
  ];
}

function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
      o.geometry.dispose();
      const mats: THREE.Material[] = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => m.dispose());
    }
  });
}

export class Scene3D {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 20, 200000);
  private readonly controls: OrbitControls;
  private readonly sun = new THREE.DirectionalLight(0xffffff, 0.75 * Math.PI);
  private readonly ground: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  private readonly woodTex = makeWoodTexture();
  private grid: THREE.GridHelper | null = null;
  private stair: THREE.Group | null = null;
  private box: { c: THREE.Vector3; ext: number; mirrored: boolean } | null = null;
  private last: Stair | null = null;
  private lastForme: string | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly errBox: HTMLElement,
  ) {
    // preserveDrawingBuffer : permet les captures d'écran de la vue.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    host.appendChild(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.addEventListener("change", () => this.render());
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f96, 0.62 * Math.PI));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.radius = 4;
    this.scene.add(this.sun, this.sun.target);
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(60000, 60000),
      new THREE.MeshStandardMaterial({ roughness: 1 }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    this.applyTheme();
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
  }

  /** Reprend les couleurs du thème clair ou sombre. */
  applyTheme(): void {
    this.scene.background = new THREE.Color(cssVar("--scene") || "#e3e8ed");
    this.ground.material.color.set(cssVar("--ground") || "#d3d9e0");
    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.dispose();
    }
    const gc = new THREE.Color(cssVar("--grid") || "#b9c2cc");
    this.grid = new THREE.GridHelper(12000, 24, gc, gc);
    this.grid.position.y = 1;
    this.scene.add(this.grid);
    if (this.last) this.draw(this.last);
    else this.render();
  }

  /** Capture JPEG de la vue, rendue dans le thème clair pour l'impression ; le thème est rétabli aussitôt. */
  snapshot(): { data: Uint8Array; w: number; h: number } | null {
    if (!this.last) return null;
    const root = document.documentElement,
      prev = root.getAttribute("data-theme");
    root.setAttribute("data-theme", "light");
    this.applyTheme();
    const url = this.renderer.domElement.toDataURL("image/jpeg", 0.9);
    if (prev === null) root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", prev);
    this.applyTheme();
    const bin = atob(url.slice(url.indexOf(",") + 1));
    const data = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const { width: w, height: h } = this.renderer.domElement;
    return w && h ? { data, w, h } : null;
  }

  private resize(): void {
    const w = this.host.clientWidth,
      h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private clear(): void {
    if (!this.stair) return;
    this.scene.remove(this.stair);
    disposeTree(this.stair);
    this.stair = null;
    this.box = null;
  }

  showError(message: string): void {
    this.clear();
    this.last = null;
    this.errBox.hidden = false;
    this.errBox.textContent = message;
    this.render();
  }

  draw(R: Stair): void {
    this.clear();
    this.last = R;
    this.errBox.hidden = true;
    const p = R.params;
    const col = new THREE.Color(ESS[p.ess] ?? ESS.chene);
    const wood = new THREE.MeshStandardMaterial({ color: col, map: this.woodTex, roughness: 0.62, metalness: 0 });
    const woodDark = new THREE.MeshStandardMaterial({
      color: col.clone().multiplyScalar(0.86),
      map: this.woodTex,
      roughness: 0.66,
    });
    const g = new THREE.Group();
    R.treads.forEach((t) => {
      g.add(extrudePlan(t.solid, t.top - p.et, p.et, wood));
      if (t.nose) g.add(noseMesh(t.nose, t.top - p.et, p.et, R.rn, wood));
    });
    R.risers.forEach((r) => g.add(extrudePlan(r.plan, r.z0, Math.max(1, r.z1 - r.z0), wood)));
    R.stringers.forEach((sp) => g.add(stringerMesh(sp, woodDark)));
    railingMeshes(R, wood).forEach((m) => g.add(m));
    if (R.newel) {
      const nb = shaded(new THREE.BoxGeometry(R.newel.size, R.newel.h, R.newel.size), woodDark);
      nb.position.set(R.newel.c[0], R.newel.h / 2, -R.newel.c[1]);
      g.add(nb);
    }
    // Plancher haut, translucide pour garder l'escalier lisible, percé de la trémie.
    const S = R.slab,
      Tr = R.tre;
    const outline = new THREE.Shape(
      v2([
        [S.x0, S.y0],
        [S.x1, S.y0],
        [S.x1, S.y1],
        [S.x0, S.y1],
      ]),
    );
    outline.holes.push(
      new THREE.Path(
        v2([
          [Tr.x0, Tr.y0],
          [Tr.x1, Tr.y0],
          [Tr.x1, Tr.y1],
          [Tr.x0, Tr.y1],
        ]),
      ),
    );
    const sg = new THREE.ExtrudeGeometry(outline, { depth: p.ep, bevelEnabled: false });
    sg.rotateX(-Math.PI / 2);
    sg.translate(0, R.ceil, 0);
    const slab = new THREE.MeshStandardMaterial({
      color: new THREE.Color(cssVar("--rule") || "#c9d0d9"),
      roughness: 0.95,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    });
    g.add(new THREE.Mesh(sg, slab));
    g.add(
      new THREE.LineSegments(
        new THREE.EdgesGeometry(sg),
        new THREE.LineBasicMaterial({ color: new THREE.Color(cssVar("--muted") || "#5a6472") }),
      ),
    );
    // Échappée : trait vertical entre la ligne des nez et la sous-face du plancher
    if (R.ech) {
      const e = R.ech,
        len = R.ceil - e.z;
      if (len > 0) {
        const rod = new THREE.Mesh(
          new THREE.CylinderGeometry(9, 9, len, 10),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(cssVar("--" + R.st.ech)) }),
        );
        rod.position.set(e.pt[0], e.z + len / 2, -e.pt[1]);
        g.add(rod);
      }
    }
    const mirrored = p.forme === "quart-g";
    if (mirrored) g.scale.x = -1;
    this.stair = g;
    this.scene.add(g);

    const box = new THREE.Box3().setFromObject(g),
      size = box.getSize(new THREE.Vector3()),
      c = box.getCenter(new THREE.Vector3());
    const ext = Math.max(size.x, size.y, size.z);
    this.sun.position.set(c.x - ext * 0.8, c.y + ext * 2.2, c.z + ext * 1.4);
    this.sun.target.position.copy(c);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -ext * 1.3;
    sc.right = sc.top = ext * 1.3;
    sc.near = 10;
    sc.far = ext * 6;
    sc.updateProjectionMatrix();
    this.box = { c, ext, mirrored };
    if (this.lastForme !== p.forme) {
      this.viewPerspective();
      this.lastForme = p.forme;
    }
    this.render();
  }

  /** Distance de recul qui garde l'escalier entier dans un cadre étroit. */
  private reach(): number {
    return this.box!.ext * Math.max(1, 1.3 / this.camera.aspect);
  }

  viewPerspective(): void {
    if (!this.box) return;
    const { c, mirrored } = this.box,
      sx = mirrored ? -1 : 1,
      ext = this.reach();
    this.camera.position.set(c.x + sx * ext * 1.25, c.y + ext * 0.7, c.z + ext * 1.55);
    this.controls.target.copy(c);
    this.controls.update();
    this.render();
  }

  viewTop(): void {
    if (!this.box) return;
    const { c } = this.box,
      ext = this.reach();
    this.camera.position.set(c.x, c.y + ext * 2.6, c.z + 1);
    this.controls.target.copy(c);
    this.controls.update();
    this.render();
  }
}
