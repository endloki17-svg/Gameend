import * as THREE from 'https://esm.sh/three@0.158.0';
import { EffectComposer } from 'https://esm.sh/three@0.158.0/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'https://esm.sh/three@0.158.0/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'https://esm.sh/three@0.158.0/examples/jsm/postprocessing/UnrealBloomPass.js';

// ==========================================
// 1. 3D 엔진 전역 변수 및 물리(Collision) 데이터
// ==========================================
export const Engine = {
    scene: null, camera: null, renderer: null, composer: null,
    collidables: [], // 벽, 바닥 등 충돌 가능한 오브젝트 배열 (AABB 충돌용)
    enemies: {}, 
    tracers: [], particles: [], decals: [], damageTexts: [],
    myGunMesh: null, gunBarrelEnd: null,
    playerRadius: 0.8, // 플레이어 충돌체 크기
    playerHeight: 2.0
};

const PI_2 = Math.PI / 2;

// ==========================================
// 2. 아레나 맵 건축 & 충돌체(AABB) 셋업
// ==========================================
export function buildArenaMap() {
    // 라이벌(Rivals) 특유의 깔끔한 플라스틱 질감 매터리얼
    const matFloor = new THREE.MeshStandardMaterial({color: 0x2a2a35, roughness: 0.8, metalness: 0.1});
    const matWall = new THREE.MeshStandardMaterial({color: 0xdddddd, roughness: 0.4});
    const matRed = new THREE.MeshStandardMaterial({color: 0xff3366, roughness: 0.3});
    const matBlue = new THREE.MeshStandardMaterial({color: 0x3388ff, roughness: 0.3});
    const matGlass = new THREE.MeshPhysicalMaterial({color: 0x00ffff, transmission: 0.5, opacity: 1, transparent: true, roughness: 0.1});

    // 바닥
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(150, 150), matFloor);
    floor.rotation.x = -Math.PI/2; floor.receiveShadow = true;
    Engine.scene.add(floor);
    addCollidable(floor, 'floor');

    // 맵 외곽 보이지 않는 거대 벽 (낙하 방지)
    const bounds = [
        { x: 0, z: -75, w: 150, d: 2 }, { x: 0, z: 75, w: 150, d: 2 },
        { x: -75, z: 0, w: 2, d: 150 }, { x: 75, z: 0, w: 2, d: 150 }
    ];
    bounds.forEach(b => {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(b.w, 50, b.d), new THREE.MeshBasicMaterial({visible: false}));
        wall.position.set(b.x, 25, b.z);
        Engine.scene.add(wall);
        addCollidable(wall, 'wall');
    });

    // 중앙 격전지 (유리 엄폐물과 블록)
    const centerBlock = new THREE.Mesh(new THREE.BoxGeometry(12, 8, 12), matWall);
    centerBlock.position.set(0, 4, 0); centerBlock.castShadow = true; centerBlock.receiveShadow = true;
    Engine.scene.add(centerBlock); addCollidable(centerBlock, 'wall');

    const glassCover1 = new THREE.Mesh(new THREE.BoxGeometry(16, 6, 1), matGlass);
    glassCover1.position.set(0, 3, 15); glassCover1.castShadow = true;
    Engine.scene.add(glassCover1); addCollidable(glassCover1, 'wall');

    const glassCover2 = new THREE.Mesh(new THREE.BoxGeometry(16, 6, 1), matGlass);
    glassCover2.position.set(0, 3, -15); glassCover2.castShadow = true;
    Engine.scene.add(glassCover2); addCollidable(glassCover2, 'wall');

    // 각 진영(레드/블루) 베이스 및 2층 경사로
    function buildBase(zOffset, mat) {
        // 1층 메인 블록
        const base = new THREE.Mesh(new THREE.BoxGeometry(30, 6, 15), mat);
        base.position.set(0, 3, zOffset); base.castShadow = true; base.receiveShadow = true;
        Engine.scene.add(base); addCollidable(base, 'wall');

        // 양옆 경사로(Ramp) - 플레이어가 걸어 올라갈 수 있음
        const rampGeo = new THREE.BoxGeometry(8, 1, 15);
        
        const rampL = new THREE.Mesh(rampGeo, matWall);
        rampL.rotation.x = Math.PI/8 * (zOffset>0 ? 1 : -1);
        rampL.position.set(-20, 2.5, zOffset>0 ? zOffset-6 : zOffset+6);
        rampL.castShadow = true; rampL.receiveShadow = true;
        Engine.scene.add(rampL); addCollidable(rampL, 'ramp');

        const rampR = new THREE.Mesh(rampGeo, matWall);
        rampR.rotation.x = Math.PI/8 * (zOffset>0 ? 1 : -1);
        rampR.position.set(20, 2.5, zOffset>0 ? zOffset-6 : zOffset+6);
        rampR.castShadow = true; rampR.receiveShadow = true;
        Engine.scene.add(rampR); addCollidable(rampR, 'ramp');
    }
    
    buildBase(-40, matRed); // 레드팀 진영
    buildBase(40, matBlue); // 블루팀 진영
    
    // 추가 랜덤 엄폐물
    for(let i=0; i<20; i++) {
        const cover = new THREE.Mesh(new THREE.BoxGeometry(4, 5, 4), matWall);
        cover.position.set(Math.random()*100-50, 2.5, Math.random()*100-50);
        // 중앙과 베이스 근처엔 스폰 안 되게
        if(cover.position.distanceTo(new THREE.Vector3(0,0,0)) > 25) {
            cover.castShadow = true; cover.receiveShadow = true;
            Engine.scene.add(cover); addCollidable(cover, 'wall');
        }
    }
}

function addCollidable(mesh, type) {
    // AABB 충돌 처리를 위해 BoundingBox 계산
    mesh.geometry.computeBoundingBox();
    Engine.collidables.push({ mesh: mesh, type: type });
}

// ==========================================
// 3. 물리 엔진 (AABB 미끄러짐 충돌)
// ==========================================
export function applyPhysicsAndCollision(camera, velocity, delta, isCrouching) {
    const nextX = camera.position.x - velocity.x * delta;
    const nextZ = camera.position.z - velocity.z * delta;
    
    // 플레이어의 가상 AABB 바운딩 박스
    const pHeight = isCrouching ? 1.0 : Engine.playerHeight;
    const r = Engine.playerRadius;

    let canMoveX = true;
    let canMoveZ = true;
    let groundY = 0; // 바닥 높이 (경사로 포함)

    // AABB 충돌 검사
    Engine.collidables.forEach(col => {
        const box = new THREE.Box3().setFromObject(col.mesh);
        
        // 경사로 및 바닥(Y축) 검사
        if (camera.position.x >= box.min.x && camera.position.x <= box.max.x &&
            camera.position.z >= box.min.z && camera.position.z <= box.max.z) {
            if(box.max.y > groundY && box.max.y <= camera.position.y) {
                groundY = box.max.y; // 밟고 있는 바닥 높이 갱신
            }
        }

        // 벽(X, Z축) 검사 - Y축이 걸쳐있는지 확인
        if (camera.position.y - pHeight < box.max.y && camera.position.y > box.min.y) {
            // X 이동 시도 시 Z축이 겹쳐있는지 확인
            if (camera.position.z + r > box.min.z && camera.position.z - r < box.max.z) {
                if (nextX + r > box.min.x && nextX - r < box.max.x) canMoveX = false;
            }
            // Z 이동 시도 시 X축이 겹쳐있는지 확인
            if (camera.position.x + r > box.min.x && camera.position.x - r < box.max.x) {
                if (nextZ + r > box.min.z && nextZ - r < box.max.z) canMoveZ = false;
            }
        }
    });

    // 충돌하지 않는 방향으로만 이동 (벽 타기/미끄러짐 가능)
    if (canMoveX) camera.position.x = nextX;
    else velocity.x = 0;
    
    if (canMoveZ) camera.position.z = nextZ;
    else velocity.z = 0;

    // 중력 및 바닥 충돌
    velocity.y -= 40.0 * delta; // 중력
    camera.position.y += velocity.y * delta;

    // 바닥(또는 경사로)에 착지
    if (camera.position.y < groundY + pHeight) {
        velocity.y = 0;
        camera.position.y = groundY + pHeight;
        return true; // canJump = true
    }
    return false; // 공중에 있음
}

// ==========================================
// 4. 초고퀄리티 무기 조립 (Rivals 스타일 모델링)
// ==========================================
// 파츠별로 분리해서 조립하여 "막대기"를 탈피합니다.
export function buildWeaponModel(weaponId, camera) {
    if(Engine.myGunMesh) camera.remove(Engine.myGunMesh);
    Engine.myGunMesh = new THREE.Group();
    
    const matDark = new THREE.MeshStandardMaterial({color: 0x1a1a24, roughness: 0.4, metalness: 0.8});
    const matSilver = new THREE.MeshStandardMaterial({color: 0x888888, roughness: 0.2, metalness: 1.0});
    const matNeon = new THREE.MeshBasicMaterial({color: 0xff3366}); // 무기 고유색으로 덮어씌워짐

    let glowColor = 0xffffff;

    if(weaponId === 0) { 
        // [0] 전술 권총 (Pistol)
        glowColor = 0x00ffff; matNeon.color.setHex(glowColor);
        const slide = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.35), matSilver);
        slide.position.set(0, -0.05, -0.1); Engine.myGunMesh.add(slide);
        
        const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.15, 0.08), matDark);
        grip.position.set(0, -0.15, 0.02); grip.rotation.x = 0.2; Engine.myGunMesh.add(grip);
        
        const neonLine = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.01, 0.15), matNeon);
        neonLine.position.set(0, -0.01, -0.15); Engine.myGunMesh.add(neonLine);

        Engine.gunBarrelEnd = new THREE.Object3D(); 
        Engine.gunBarrelEnd.position.set(0, -0.05, -0.28); 
        Engine.myGunMesh.add(Engine.gunBarrelEnd);
    } 
    else if(weaponId === 1) { 
        // [1] 매그넘 리볼버 (Revolver)
        glowColor = 0xff3333; matNeon.color.setHex(glowColor);
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 8), matSilver);
        barrel.rotation.x = Math.PI/2; barrel.position.set(0, -0.05, -0.25); Engine.myGunMesh.add(barrel);
        
        // 리볼버 실린더 (탄창)
        const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 8), matDark);
        cylinder.rotation.x = Math.PI/2; cylinder.position.set(0, -0.05, 0); Engine.myGunMesh.add(cylinder);
        
        const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.15, 0.08), new THREE.MeshStandardMaterial({color: 0x3d2314})); // 나무 질감
        grip.position.set(0, -0.18, 0.1); grip.rotation.x = 0.3; Engine.myGunMesh.add(grip);
        
        const neon = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.005, 8, 8), matNeon);
        neon.rotation.y = Math.PI/2; neon.position.set(0, -0.05, -0.06); Engine.myGunMesh.add(neon);

        Engine.gunBarrelEnd = new THREE.Object3D(); 
        Engine.gunBarrelEnd.position.set(0, -0.05, -0.45); 
        Engine.myGunMesh.add(Engine.gunBarrelEnd);
    }
    else if(weaponId === 2) { 
        // [2] 돌격 소총 (Assault Rifle)
        glowColor = 0x3388ff; matNeon.color.setHex(glowColor);
        const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.4), matDark);
        receiver.position.set(0, -0.1, 0); Engine.myGunMesh.add(receiver);
        
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.5, 8), matSilver);
        barrel.rotation.x = Math.PI/2; barrel.position.set(0, -0.08, -0.45); Engine.myGunMesh.add(barrel);
        
        const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.1), matDark);
        mag.position.set(0, -0.25, -0.05); mag.rotation.x = 0.1; Engine.myGunMesh.add(mag);
        
        const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.25), matDark);
        stock.position.set(0, -0.1, 0.3); Engine.myGunMesh.add(stock);

        // 홀로그래픽 사이트
        const sight = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.08), matDark);
        sight.position.set(0, -0.01, -0.05); Engine.myGunMesh.add(sight);
        const dot = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.01), matNeon);
        dot.position.set(0, 0.01, -0.09); Engine.myGunMesh.add(dot);

        Engine.gunBarrelEnd = new THREE.Object3D(); 
        Engine.gunBarrelEnd.position.set(0, -0.08, -0.7); 
        Engine.myGunMesh.add(Engine.gunBarrelEnd);
    }
    else if(weaponId === 3) { 
        // [3] 카타나 (Katana) - 근접 무기
        glowColor = 0xffffff; matNeon.color.setHex(glowColor);
        const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 8), matDark);
        hilt.rotation.x = Math.PI/2; hilt.position.set(0, -0.1, 0); Engine.myGunMesh.add(hilt);
        
        const tsuba = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.02), matSilver);
        tsuba.position.set(0, -0.1, -0.15); Engine.myGunMesh.add(tsuba);
        
        // 빛나는 칼날
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.05, 0.9), matNeon);
        blade.position.set(0, -0.1, -0.6); Engine.myGunMesh.add(blade);
        
        Engine.gunBarrelEnd = new THREE.Object3D(); 
        Engine.gunBarrelEnd.position.set(0, -0.1, -1.05); 
        Engine.myGunMesh.add(Engine.gunBarrelEnd);
    }
    else if(weaponId === 4) { 
        // [4] 메디킷 (Medkit)
        glowColor = 0x00ff00; matNeon.color.setHex(glowColor);
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.2, 0.1), matDark);
        box.position.set(0, -0.1, -0.2); Engine.myGunMesh.add(box);
        
        const handle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.02), matSilver);
        handle.position.set(0, 0.02, -0.2); Engine.myGunMesh.add(handle);
        
        // 십자가 무늬
        const cross1 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.11), matNeon);
        cross1.position.set(0, -0.1, -0.2); Engine.myGunMesh.add(cross1);
        const cross2 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.11), matNeon);
        cross2.position.set(0, -0.1, -0.2); Engine.myGunMesh.add(cross2);
        
        Engine.gunBarrelEnd = new THREE.Object3D(); 
        Engine.gunBarrelEnd.position.set(0, -0.1, -0.25); 
        Engine.myGunMesh.add(Engine.gunBarrelEnd);
    }
    
    // 무기 은은한 조명 (Bloom 효과 최적화)
    const gunLight = new THREE.PointLight(glowColor, 0.5, 2);
    gunLight.position.set(0, 0, -0.2);
    Engine.myGunMesh.add(gunLight);
    
    // 카메라 우측 하단 정렬
    Engine.myGunMesh.position.set(0.3, -0.25, -0.4);
    camera.add(Engine.myGunMesh);
}

// ==========================================
// 5. 로블록스 R6 블록 캐릭터 셋업
// ==========================================
export function createEnemyModel(id, name) {
    const group = new THREE.Group();
    // 로블록스 클래식 컬러
    const mHead = new THREE.MeshStandardMaterial({color: 0xf5cd30, roughness: 0.5}); // 노란 얼굴
    const mTorso = new THREE.MeshStandardMaterial({color: 0x0055ff, roughness: 0.8}); // 파란 티셔츠
    const mLegs = new THREE.MeshStandardMaterial({color: 0x111111, roughness: 0.8}); // 검은 바지

    // 머리 (Head)
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), mHead);
    head.position.y = 2.4; head.castShadow = true; group.add(head);
    
    // 선글라스 모양의 눈 (Rivals 스타일 바이저)
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 0.82), new THREE.MeshBasicMaterial({color: 0x000000}));
    visor.position.y = 2.45; group.add(visor);

    // 몸통 (Torso)
    const torso = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 0.8), mTorso);
    torso.position.y = 1.2; torso.castShadow = true; group.add(torso);
    
    // 팔 (Arms)
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.6, 0.6), mHead);
    armL.position.set(-1.1, 1.2, 0); armL.castShadow = true; group.add(armL);
    const armR = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.6, 0.6), mHead);
    armR.position.set(1.1, 1.2, 0); armR.castShadow = true; group.add(armR);

    // 다리 (Legs)
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.75, 1.6, 0.75), mLegs);
    legL.position.set(-0.4, -0.4, 0); legL.castShadow = true; group.add(legL);
    const legR = new THREE.Mesh(new THREE.BoxGeometry(0.75, 1.6, 0.75), mLegs);
    legR.position.set(0.4, -0.4, 0); legR.castShadow = true; group.add(legR);

    // 닉네임 태그 (Canvas Sprite)
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 128;
    const ctx = canvas.getContext('2d'); const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    sprite.position.y = 3.4; sprite.scale.set(1.5, 0.75, 1); group.add(sprite);
    
    Engine.enemies[id] = { mesh: group, ctx: ctx, tex: tex, hp: 100, name: name, torso: torso };
    Engine.scene.add(group);
}

export function updateEnemyUI(id) {
    const e = Engine.enemies[id];
    if(!e) return;
    e.ctx.clearRect(0,0,256,128);
    e.ctx.fillStyle = '#000'; e.ctx.font = 'bold 30px Teko, sans-serif'; e.ctx.textAlign = 'center';
    e.ctx.fillText(e.name, 130, 42); // 텍스트 그림자
    e.ctx.fillStyle = '#ff3366'; e.ctx.fillText(e.name, 128, 40);
    
    // 체력바
    e.ctx.fillStyle = '#111'; e.ctx.fillRect(28, 60, 200, 16);
    e.ctx.fillStyle = e.hp > 50 ? '#00ff00' : e.hp > 20 ? '#ffff00' : '#ff0000';
    e.ctx.fillRect(30, 62, 196 * (e.hp/100), 12);
    e.tex.needsUpdate = true;
}

// ==========================================
// 6. 엔진 시동 함수 (GUI 스크립트에서 호출됨)
// ==========================================
export function startEngine(container, isMobile) {
    Engine.scene = new THREE.Scene();
    Engine.scene.background = new THREE.Color(0x1a1a24);
    Engine.scene.fog = new THREE.Fog(0x1a1a24, 10, 150);

    Engine.camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.1, 1000);
    Engine.camera.rotation.order = 'YXZ';

    Engine.renderer = new THREE.WebGLRenderer({ antialias: !isMobile, powerPreference: "high-performance" });
    Engine.renderer.setSize(window.innerWidth, window.innerHeight);
    Engine.renderer.setPixelRatio(isMobile ? 1 : Math.min(window.devicePixelRatio, 1.5));
    Engine.renderer.shadowMap.enabled = true;
    Engine.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(Engine.renderer.domElement);

    const renderScene = new RenderPass(Engine.scene, Engine.camera);
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.2, 0.4, 0.85);
    Engine.composer = new EffectComposer(Engine.renderer);
    Engine.composer.addPass(renderScene);
    Engine.composer.addPass(bloomPass);

    // 글로벌 라이팅
    Engine.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dl = new THREE.DirectionalLight(0xffffff, 0.8); 
    dl.position.set(50, 100, 50); 
    dl.castShadow = true;
    dl.shadow.camera.near = 0.5; dl.shadow.camera.far = 200;
    const d = 80; dl.shadow.camera.left = -d; dl.shadow.camera.right = d; dl.shadow.camera.top = d; dl.shadow.camera.bottom = -d;
    Engine.scene.add(dl);

    buildArenaMap();
}

// GUI 스크립트에서 이 모듈을 사용할 수 있도록 전역 객체에 매핑
window.Game3D = {
    Engine,
    startEngine,
    buildWeaponModel,
    createEnemyModel,
    updateEnemyUI,
    applyPhysicsAndCollision
};
