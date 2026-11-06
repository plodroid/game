import * as THREE from 'three';

interface BackKit {
  mesh: (geo: THREE.BufferGeometry, m: THREE.Material, x?: number, y?: number, z?: number) => THREE.Mesh;
  mat: (color: number, extra?: Partial<THREE.MeshStandardMaterialParameters>) => THREE.Material;
  team: THREE.Material;
  teamFlat: THREE.Material;
  dark: THREE.Material;
  white: THREE.Material;
  accent: THREE.Material;
  glass: THREE.Material;
  detail: number;
}

/** The back of the torso, in spine space: +z is behind the character. */
const BACK = 0.17;

function wingShape(kind: 'paper' | 'bat' | 'butterfly') {
  const s = new THREE.Shape();
  if (kind === 'paper') {
    s.moveTo(0, 0);
    s.lineTo(0.36, 0.22);
    s.lineTo(0.3, 0.06);
    s.lineTo(0.4, 0.02);
    s.lineTo(0.28, -0.04);
    s.lineTo(0.32, -0.14);
    s.lineTo(0, -0.04);
  } else if (kind === 'bat') {
    s.moveTo(0, 0.02);
    s.lineTo(0.18, 0.2);
    s.lineTo(0.42, 0.14);
    s.quadraticCurveTo(0.36, 0.02, 0.4, -0.08);
    s.quadraticCurveTo(0.3, -0.02, 0.26, -0.12);
    s.quadraticCurveTo(0.16, -0.04, 0.12, -0.12);
    s.quadraticCurveTo(0.06, -0.04, 0, -0.04);
  } else {
    s.moveTo(0, 0);
    s.bezierCurveTo(0.12, 0.3, 0.36, 0.3, 0.32, 0.08);
    s.bezierCurveTo(0.3, 0.0, 0.34, -0.06, 0.26, -0.16);
    s.bezierCurveTo(0.18, -0.24, 0.06, -0.14, 0, -0.02);
  }
  return s;
}

export function buildBack(spine: THREE.Object3D, id: string, k: BackKit) {
  const { mesh, mat, team, teamFlat, dark, white, accent } = k;
  const s = (n: number) => Math.round(n + (n * k.detail) / 2);
  const add = (...o: THREE.Object3D[]) => spine.add(...o);
  const Z = Math.PI / 2;
  const tank = (x: number, r: number, h: number) => {
    add(mesh(new THREE.CylinderGeometry(r, r, h, s(10)), mat(0xdfe8f5, { transparent: true, opacity: 0.35, roughness: 0.08 }), x, 0.27, BACK + r));
    add(mesh(new THREE.CylinderGeometry(r * 0.82, r * 0.82, h * 0.8, s(10)), team, x, 0.25, BACK + r));
    for (const y of [-h / 2, h / 2]) add(mesh(new THREE.CylinderGeometry(r * 1.05, r * 1.05, 0.025, s(10)), dark, x, 0.27 + y, BACK + r));
  };
  const wings = (kind: 'paper' | 'bat' | 'butterfly', m: THREE.Material, m2?: THREE.Material) => {
    for (const sx of [-1, 1]) {
      const w = mesh(new THREE.ShapeGeometry(wingShape(kind)), m, sx * 0.03, 0.3, BACK + 0.03);
      w.scale.x = sx;
      w.rotation.y = sx * -0.45;
      (m as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
      add(w);
      if (m2) {
        const w2 = mesh(new THREE.ShapeGeometry(wingShape(kind)).scale(0.6, -0.65, 1), m2, sx * 0.03, 0.22, BACK + 0.035);
        w2.scale.x = sx;
        w2.rotation.y = sx * -0.45;
        (m2 as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
        add(w2);
      }
    }
  };

  switch (id) {
    case 'tank':
      tank(0, 0.07, 0.24);
      break;
    case 'twintanks':
      tank(-0.065, 0.05, 0.22);
      tank(0.065, 0.05, 0.22);
      break;
    case 'bubbletank':
      add(mesh(new THREE.SphereGeometry(0.12, s(12), s(10)), mat(0xdff2ff, { transparent: true, opacity: 0.3, roughness: 0.05 }), 0, 0.27, BACK + 0.1));
      add(mesh(new THREE.SphereGeometry(0.08, s(10), s(8)), team, 0, 0.24, BACK + 0.1));
      break;
    case 'backpack':
      add(mesh(new THREE.CapsuleGeometry(0.11, 0.1, 4, s(10)).scale(1, 1, 0.55), accent, 0, 0.24, BACK + 0.05));
      add(mesh(new THREE.BoxGeometry(0.16, 0.09, 0.03), teamFlat, 0, 0.33, BACK + 0.1));
      for (const sx of [-1, 1]) add(mesh(new THREE.BoxGeometry(0.03, 0.28, 0.33), dark, sx * 0.1, 0.27, -0.005));
      break;
    case 'satchel': {
      add(mesh(new THREE.BoxGeometry(0.16, 0.12, 0.06), accent, 0.17, 0.02, 0.05));
      const strap = mesh(new THREE.TorusGeometry(0.24, 0.012, 4, s(16)).scale(0.8, 1, 0.75), dark, 0, 0.2, 0);
      strap.rotation.set(0, Z, 0.65);
      add(strap);
      break;
    }
    case 'fin':
      add(mesh(new THREE.ConeGeometry(0.1, 0.24, 4).scale(0.25, 1, 1).rotateX(0.5), teamFlat, 0, 0.3, BACK + 0.05));
      break;
    case 'flag': {
      add(mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.7, 5), dark, 0.07, 0.5, BACK + 0.02));
      const tri = new THREE.Shape();
      tri.moveTo(0, 0);
      tri.lineTo(0.22, -0.07);
      tri.lineTo(0, -0.14);
      const f = mesh(new THREE.ShapeGeometry(tri), teamFlat, 0.07, 0.84, BACK + 0.02);
      f.rotation.y = -Z;
      (teamFlat as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
      add(f);
      break;
    }
    case 'cans':
      add(mesh(new THREE.BoxGeometry(0.22, 0.1, 0.07), dark, 0, 0.2, BACK + 0.035));
      for (const [x, c] of [[-0.07, 0xff4d94], [0, 0xffc532], [0.07, 0x2fd3d0]] as const) {
        add(mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.16, s(8)), mat(c, { roughness: 0.35, metalness: 0.3 }), x, 0.27, BACK + 0.05));
        add(mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.03, 6), white, x, 0.365, BACK + 0.05));
      }
      break;
    case 'cape': {
      const n = s(8);
      const b = new THREE.BufferGeometry();
      const pos: number[] = [], idx: number[] = [];
      for (let i = 0; i <= n; i++)
        for (let j = 0; j <= 4; j++) {
          const u = i / n - 0.5, w = j / 4;
          pos.push(u * (0.36 + w * 0.2), 0.42 - w * 0.78, BACK - 0.02 + w * 0.12 + Math.cos(u * Math.PI) * 0.04);
        }
      for (let i = 0; i < n; i++)
        for (let j = 0; j < 4; j++) {
          const a = i * 5 + j, c = (i + 1) * 5 + j;
          idx.push(a, a + 1, c, c, a + 1, c + 1);
        }
      b.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      b.setIndex(idx);
      b.computeVertexNormals();
      const m = mat(0xffffff, { roughness: 0.7, side: THREE.DoubleSide });
      (m as THREE.MeshStandardMaterial).color.copy((teamFlat as THREE.MeshStandardMaterial).color);
      add(mesh(b, m));
      break;
    }
    case 'roller': {
      const g = new THREE.Group();
      g.add(mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.55, s(6)), dark, 0, 0, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.34, s(10)).rotateZ(Z), teamFlat, 0, 0.3, 0));
      g.position.set(0, 0.22, BACK + 0.08);
      g.rotation.z = 0.6;
      add(g);
      break;
    }
    case 'brush': {
      const g = new THREE.Group();
      g.add(mesh(new THREE.CylinderGeometry(0.02, 0.024, 0.6, s(6)), mat(0xb5814a, { roughness: 0.7 }), 0, 0, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.06, s(8)), mat(0xc9ced8, { metalness: 0.8, roughness: 0.3 }), 0, 0.32, 0));
      g.add(mesh(new THREE.BoxGeometry(0.09, 0.14, 0.04), teamFlat, 0, 0.42, 0));
      g.position.set(0, 0.22, BACK + 0.06);
      g.rotation.z = -0.65;
      add(g);
      break;
    }
    case 'radio':
      add(mesh(new THREE.BoxGeometry(0.2, 0.24, 0.1), mat(0x4b5a3a, { roughness: 0.8 }), 0, 0.25, BACK + 0.05));
      add(mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.4, 4), dark, 0.07, 0.55, BACK + 0.05));
      add(mesh(new THREE.SphereGeometry(0.012, 6, 4), team, 0.07, 0.75, BACK + 0.05));
      add(mesh(new THREE.BoxGeometry(0.06, 0.03, 0.012), team, -0.04, 0.32, BACK + 0.101));
      break;
    case 'shell':
      add(mesh(new THREE.SphereGeometry(0.22, s(12), s(8), 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Z).scale(0.95, 1.15, 0.5), mat(0x3f8f4a, { roughness: 0.6 }), 0, 0.22, BACK - 0.04));
      add(mesh(new THREE.TorusGeometry(0.21, 0.018, 4, s(14)).scale(0.95, 1.15, 1), mat(0xd8c39a, { roughness: 0.7 }), 0, 0.22, BACK - 0.03));
      break;
    case 'balloon':
      add(mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.55, 3).rotateZ(-0.35), white, 0.16, 0.52, BACK + 0.03));
      add(mesh(new THREE.SphereGeometry(0.12, s(12), s(10)).scale(1, 1.18, 1), team, 0.3, 0.86, BACK + 0.03));
      break;
    case 'gear': {
      const metal = mat(0xb9bcc6, { metalness: 0.85, roughness: 0.3 });
      add(mesh(new THREE.TorusGeometry(0.13, 0.03, 6, s(16)), metal, 0, 0.28, BACK + 0.04));
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const t = mesh(new THREE.BoxGeometry(0.04, 0.05, 0.05), metal, Math.cos(a) * 0.17, 0.28 + Math.sin(a) * 0.17, BACK + 0.04);
        t.rotation.z = a;
        add(t);
      }
      add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.06, s(8)).rotateX(Z), team, 0, 0.28, BACK + 0.04));
      break;
    }
    case 'jetpack': {
      const flame = mat(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.9 });
      (flame as THREE.MeshStandardMaterial).color.copy((team as THREE.MeshStandardMaterial).color);
      (flame as THREE.MeshStandardMaterial).emissive.copy((team as THREE.MeshStandardMaterial).color);
      for (const sx of [-1, 1]) {
        add(mesh(new THREE.CapsuleGeometry(0.055, 0.2, 4, s(10)), accent, sx * 0.07, 0.25, BACK + 0.07));
        add(mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.06, s(8)), dark, sx * 0.07, 0.08, BACK + 0.07));
        add(mesh(new THREE.ConeGeometry(0.035, 0.12, s(8)).rotateX(Math.PI), flame, sx * 0.07, -0.0, BACK + 0.07));
      }
      add(mesh(new THREE.BoxGeometry(0.1, 0.16, 0.04), dark, 0, 0.27, BACK + 0.03));
      break;
    }
    case 'wings':
      wings('paper', mat(0xf4efe9, { roughness: 0.8 }));
      break;
    case 'batwings':
      wings('bat', mat(0x2a2234, { roughness: 0.6 }));
      break;
    case 'butterfly': {
      const a = mat(0xffffff, { roughness: 0.4, emissive: 0, emissiveIntensity: 0.2 });
      (a as THREE.MeshStandardMaterial).color.copy((teamFlat as THREE.MeshStandardMaterial).color);
      wings('butterfly', a, mat(0xffc532, { roughness: 0.4, emissive: 0xffc532, emissiveIntensity: 0.15 }));
      break;
    }
    case 'ring':
      add(mesh(new THREE.TorusGeometry(0.2, 0.014, 6, s(20)), team, 0, 0.55, BACK + 0.12));
      break;
  }
}
