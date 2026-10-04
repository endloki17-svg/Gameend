import * as THREE from 'https://esm.sh/three@0.158.0';
import { EffectComposer } from 'https://esm.sh/three@0.158.0/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'https://esm.sh/three@0.158.0/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'https://esm.sh/three@0.158.0/examples/jsm/postprocessing/UnrealBloomPass.js';

// ==========================================
// 1. 엔진 코어 및 상태 변수
// ==========================================
export const Engine = {
    scene: null, camera: null, renderer: null, composer: null,
    collidables: [], enemies: {}, tracers: [], particles: [], decals: [], damageTexts: [],
    myGunMesh: null, gunBarrelEnd: null, gunLaser: null,
    
    // 조작 상태 (HTML과 연동)
    input: { forward: false, backward: false, left: false, right: false, jump: false, shoot: false, aim: false },
    joyDir: { x: 0, y: 0 },
    lookDelta: { x: 0, y: 0 },
    
    velocity: new THREE.Vector3(),
    direction: new THREE.Vector3(),
    canJump: false,
    playerRadius: 0.8,
    playerHeight: 2.0,
    currentRecoil: new THREE.Vector3(),
    recoilTarget: new THREE.Vector3()
};

const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const PI_2 = Math.PI / 2;

// ==========================================
// 2. 100+ 스킨을 위한 절차적 텍스처 생성기
// ==========================================
function generateSkinTexture(skinType) {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext('2d');

    if (skinType === 'carbon') {
        ctx.fillStyle = '#111'; ctx.fillRect(0,0,256,256);
        ctx.fillStyle = '#222';
        for(let i=0; i<256; i+=16) {
            for(let j=0; j<256; j+=16) {
                if((i+j)%32 === 0) ctx.fillRect(i, j, 16, 16);
            }
        }
    } else if (skinType === 'camo_desert') {
        ctx.fillStyle = '#c2b280'; ctx.fillRect(0,0,256,256);
        for(let i=0; i<30; i++) {
            ctx.fillStyle = Math.random()>0.5 ? '#8b7355' : '#554321';
            ctx.beginPath();
            ctx.arc(Math.random()*256, Math.random()*256, Math.random()*30+10, 0, Math.PI*2);
            ctx.fill();
        }
    } else if (skinType === 'neon_hex') {
        ctx.fillStyle = '#0a0a1a'; ctx.fillRect(0,0,256,256);
        ctx.strokeStyle = '#00ffff'; ctx.lineWidth = 2;
        for(let i=0; i<256; i+=30) {
            for(let j=0; j<256; j+=30) {
                ctx.strokeRect(i, j, 20, 20);
            }
        }
    } else if (skinType === 'gold_engraved') {
        ctx.fillStyle = '#ffd700'; ctx.fillRect(0,0,256,256);
        ctx.strokeStyle = '#b8860b'; ctx.lineWidth = 2;
        for(let i=0; i<10; i++) {
            ctx.beginPath();
            ctx.moveTo(Math.random()*256, Math.random()*256);
            ctx.bezierCurveTo(Math.random()*256, Math.random()*256, Math.random()*256, Math.random()*256, Math.random()*256, Math.random()*256);
            ctx.stroke();
        }
    } else if (skinType === 'blood_web') {
        ctx.fillStyle = '#1a0000'; ctx.fillRect(0,0,256,256);
        ctx.strokeStyle = '#ff0033'; ctx.lineWidth = 3;
        for(let i=0; i<256; i+=20) { ctx.beginPath(); ctx.moveTo(128, 128); ctx.lineTo(i, 0); ctx.stroke(); ctx.lineTo(0, i); ctx.stroke(); }
    } else {
        ctx.fillStyle = '#333'; ctx.fillRect(0,0,256,256); // Default Matte
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
    return tex;
}

// ==========================================
// 3. 초고퀄리티 3D 총기 조립 공장 (Weapon Builder)
// ==========================================
export function buildWeaponModel(weaponData) {
    if(Engine.myGunMesh) Engine.camera.remove(Engine.myGunMesh);
    Engine.myGunMesh = new THREE.Group();

    // 재질(스킨) 세팅
    const skinTex = generateSkinTexture(weaponData.skin);
    const matBody = new THREE.MeshStandardMaterial({ map: skinTex, roughness: 0.3, metalness: 0.7 });
    const matDark = new THREE.MeshStandardMaterial({ color: 0x111115, roughness: 0.8, metalness: 0.2 });
    const matSilver = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.2, metalness: 1.0 });
    const matGlow = new THREE.MeshBasicMaterial({ color: weaponData.glowColor || 0x00ffff });
    const matGlass = new THREE.MeshPhysicalMaterial({ color: 0x00aaff, transmission: 0.9, opacity: 1, transparent: true });

    const type = weaponData.archetype; // 'pistol', 'ar', 'sniper', 'shotgun', 'melee'

    if(type === 'ar' || type === 'sniper' || type === 'shotgun') {
        // [1] 상부 리시버 (Main Body)
        const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.4), matBody);
        receiver.position.set(0, -0.1, 0); Engine.myGunMesh.add(receiver);

        // [2] 하부 손잡이 (Grip)
        const grip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.15, 0.08), matDark);
        grip.position.set(0, -0.22, 0.08); grip.rotation.x = 0.2; Engine.myGunMesh.add(grip);
        
        // [3] 방아쇠 및 울 (Trigger)
        const triggerGuard = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.06, 0.08), matDark);
        triggerGuard.position.set(0, -0.17, 0.02); Engine.myGunMesh.add(triggerGuard);

        // [4] 탄창 (Magazine) - 굽은 형태
        const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.25, 0.1), matDark);
        mag.position.set(0, -0.25, -0.08); mag.rotation.x = -0.1; Engine.myGunMesh.add(mag);

        // [5] 총열 (Barrel)
        const barrelLen = type === 'sniper' ? 0.8 : (type === 'shotgun' ? 0.4 : 0.5);
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, barrelLen, 12), matSilver);
        barrel.rotation.x = Math.PI/2; barrel.position.set(0, -0.08, -0.2 - barrelLen/2); Engine.myGunMesh.add(barrel);

        // [6] 핸드가드 (Handguard)
        const hgLen = barrelLen * 0.7;
        const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, hgLen), matBody);
        handguard.position.set(0, -0.1, -0.2 - hgLen/2); Engine.myGunMesh.add(handguard);

        // [7] 개머리판 (Stock)
        const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.3), matBody);
        stock.position.set(0, -0.1, 0.35); Engine.myGunMesh.add(stock);

        // [8] 조준경 (Sight)
        if(type === 'sniper') {
            // 스나이퍼 스코프
            const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 12), matDark);
            scope.rotation.x = Math.PI/2; scope.position.set(0, 0.02, -0.05); Engine.myGunMesh.add(scope);
            const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.31, 12), matGlass);
            lens.rotation.x = Math.PI/2; lens.position.set(0, 0.02, -0.05); Engine.myGunMesh.add(lens);
        } else {
            // 홀로그램 사이트
            const holoBase = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.08), matDark);
            holoBase.position.set(0, -0.01, -0.05); Engine.myGunMesh.add(holoBase);
            const holoGlass = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.05), matGlass);
            holoGlass.position.set(0, 0.04, -0.08); Engine.myGunMesh.add(holoGlass);
            const dot = new THREE.Mesh(new THREE.CircleGeometry(0.005, 8), matGlow);
            dot.position.set(0, 0.04, -0.081); Engine.myGunMesh.add(dot);
        }

        // [9] 레이저 포인터 부착
        const laserBox = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.1), matDark);
        laserBox.position.set(0.05, -0.08, -0.3); Engine.myGunMesh.add(laserBox);
        
        // 레이저 광선
        const laserLineMat = new THREE.LineBasicMaterial({ color: matGlow.color, transparent: true, opacity: 0.5 });
        const laserGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0.05, -0.08, -0.35), new THREE.Vector3(0.05, -0.08, -50)]);
        Engine.gunLaser = new THREE.Line(laserGeo, laserLineMat);
        Engine.myGunMesh.add(Engine.gunLaser);

        // [10] 총구 설정
        Engine.gunBarrelEnd = new THREE.Object3D(); 
        Engine.gunBarrelEnd.position.set(0, -0.08, -0.2 - barrelLen);
        Engine.myGunMesh.add(Engine.gunBarrelEnd);
    } 
    else if(type === 'pistol') {
        // 권총 (세밀한 슬라이드 구현)
        const slide = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.3), matBody);
        slide.position.set(0, -0.05, -0.1); Engine.myGunMesh.add(slide);
        
        const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.15, 0.08), matDark);
        grip.position.set(0, -0.15, 0.02); grip.rotation.x = 0.15; Engine.myGunMesh.add(grip);
        
        // 미니 레드닷
        const dotBase = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.04), matDark);
        dotBase.position.set(0, 0.01, -0.02); Engine.myGunMesh.add(dotBase);
        const dot = new THREE.Mesh(new THREE.CircleGeometry(0.003, 8), matGlow);
        dot.position.set(0, 0.03, -0.03); Engine.myGunMesh.add(dot);

        Engine.gunBarrelEnd = new THREE.Object3D(); 
        Engine.gunBarrelEnd.position.set(0, -0.05, -0.25);
        Engine.myGunMesh.add(Engine.gunBarrelEnd);
    }
    else if(type === 'melee') {
        // 근접 무기 (카타나/에너지 소드)
        const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 12), matDark);
        hilt.rotation.x = Math.PI/2; hilt.position.set(0, -0.1, 0); Engine.myGunMesh.add(hilt);
        
        const guard = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.02), matSilver);
        guard.position.set(0, -0.1, -0.15); Engine.myGunMesh.add(guard);
        
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.05, 1.0), matBody);
        blade.position.set(0, -0.1, -0.65); Engine.myGunMesh.add(blade);
        
        const edge = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.02, 1.0), matGlow);
        edge.position.set(0, -0.08, -0.65); Engine.myGunMesh.add(edge);

        Engine.gunBarrelEnd = new THREE.Object3D(); 
        Engine.gunBarrelEnd.position.set(0, -0.1, -1.2);
        Engine.myGunMesh.add(Engine.gunBarrelEnd);
    }

    // 총기 조명 (은은한 반사광)
    const light = new THREE.PointLight(matGlow.color, 0.5, 3);
    light.position.set(0, 0.1, -0.2);
    Engine.myGunMesh.add(light);

    // 기본 정렬 위치
    Engine.myGunMesh.position.set(0.25, -0.25, -0.4);
    Engine.camera.add(Engine.myGunMesh);
}

// ==========================================
// 4. 로블록스 R6 진보형 캐릭터 모델링
// ==========================================
export function createEnemyModel(id, name, skinType) {
    const group = new THREE.Group();
    const skinTex = generateSkinTexture(skinType || 'carbon');
    
    const mHead = new THREE.MeshStandardMaterial({color: 0xffccaa, roughness: 0.4});
    const mBody = new THREE.MeshStandardMaterial({map: skinTex, roughness: 0.5, metalness: 0.5}); // 옷에 스킨 적용
    
    // 머리
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), mHead);
    head.position.y = 2.4; head.castShadow = true; group.add(head);
    // 사이버 고글
    const goggle = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.2, 0.4), new THREE.MeshBasicMaterial({color: 0x00ffff}));
    goggle.position.set(0, 2.5, 0.25); group.add(goggle);

    // 몸통
    const torso = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 0.8), mBody);
    torso.position.y = 1.2; torso.castShadow = true; group.add(torso);
    
    // 팔
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.6, 0.6), mBody);
    armL.position.set(-1.1, 1.2, 0); armL.castShadow = true; group.add(armL);
    const armR = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.6, 0.6), mBody);
    armR.position.set(1.1, 1.2, 0); armR.castShadow = true; group.add(armR);

    // 다리
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.75, 1.6, 0.75), new THREE.MeshStandardMaterial({color: 0x222}));
    legL.position.set(-0.4, -0.4, 0); legL.castShadow = true; group.add(legL);
    const legR = new THREE.Mesh(new THREE.BoxGeometry(0.75, 1.6, 0.75), new THREE.MeshStandardMaterial({color: 0x222}));
    legR.position.set(0.4, -0.4, 0); legR.castShadow = true; group.add(legR);

    // 닉네임 / 체력바
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 128;
    const ctx = canvas.getContext('2d'); const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    sprite.position.y = 3.6; sprite.scale.set(1.5, 0.75, 1); group.add(sprite);
    
    Engine.enemies[id] = { mesh: group, ctx: ctx, tex: tex, hp: 100, name: name, torso: torso };
    Engine.scene.add(group);
}

// ==========================================
// 5. 초고퀄 아레나 맵 구축
// ==========================================
export function buildArenaMap() {
    Engine.collidables = [];
    
    const matFloor = new THREE.MeshStandardMaterial({color: 0x1f2833, roughness: 0.8, metalness: 0.2});
    const matWall = new THREE.MeshStandardMaterial({color: 0xc5c6c7, roughness: 0.4});
    const matNeon = new THREE.MeshBasicMaterial({color: 0x66fcf1});

    // 바닥
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), matFloor);
    floor.rotation.x = -Math.PI/2; floor.receiveShadow = true;
    Engine.scene.add(floor);
    
    // 박스 추가 헬퍼
    function addBox(w,h,d, x,y,z, mat) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat);
        b.position.set(x,y,z); b.castShadow=true; b.receiveShadow=true;
        Engine.scene.add(b); b.geometry.computeBoundingBox();
        Engine.collidables.push(b);
        return b;
    }

    // 네온 테두리 추가 헬퍼
    function addNeonEdge(mesh) {
        const edges = new THREE.EdgesGeometry(mesh.geometry);
        const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({color: 0x66fcf1, linewidth: 2, transparent: true, opacity: 0.5}));
        mesh.add(line);
    }

    // 중앙 타워
    const center = addBox(16, 12, 16, 0, 6, 0, matWall);
    addNeonEdge(center);

    // 엄폐물
    for(let i=0; i<30; i++) {
        const b = addBox(4+Math.random()*4, 4+Math.random()*6, 4+Math.random()*4, Math.random()*160-80, 0, Math.random()*160-80, matWall);
        b.position.y = b.geometry.parameters.height/2;
        if(Math.random()>0.7) addNeonEdge(b);
    }

    // 맵 외곽 보이지 않는 벽 (추락/이탈 방지)
    const bounds = [ {x:0,z:-100,w:200,d:2}, {x:0,z:100,w:200,d:2}, {x:-100,z:0,w:2,d:200}, {x:100,z:0,w:2,d:200} ];
    bounds.forEach(bd => addBox(bd.w, 50, bd.d, bd.x, 25, bd.z, new THREE.MeshBasicMaterial({visible:false})));
}

// ==========================================
// 6. 물리 엔진 코어 (AABB 완벽 충돌)
// ==========================================
export function applyPhysics(delta) {
    // 입력에 따른 이동 벡터 계산
    Engine.direction.x = (Engine.input.right ? 1 : 0) - (Engine.input.left ? 1 : 0) + Engine.joyDir.x;
    Engine.direction.z = (Engine.input.backward ? 1 : 0) - (Engine.input.forward ? 1 : 0) + Engine.joyDir.y;
    if(Engine.direction.lengthSq() > 1) Engine.direction.normalize();

    // 마찰 및 가속
    Engine.velocity.x -= Engine.velocity.x * 10.0 * delta;
    Engine.velocity.z -= Engine.velocity.z * 10.0 * delta;
    Engine.velocity.y -= 40.0 * delta; // 중력

    const speed = 250.0;
    Engine.velocity.x -= Engine.direction.x * speed * delta;
    Engine.velocity.z -= Engine.direction.z * speed * delta;

    // 카메라 로컬 축 기준 속도를 월드 축으로 변환
    const camEuler = new THREE.Euler(0, Engine.camera.rotation.y, 0);
    const moveVec = new THREE.Vector3(-Engine.velocity.x * delta, 0, -Engine.velocity.z * delta);
    moveVec.applyEuler(camEuler);

    const nextX = Engine.camera.position.x + moveVec.x;
    const nextZ = Engine.camera.position.z + moveVec.z;
    const r = Engine.playerRadius;
    const h = Engine.playerHeight;
    
    let canMoveX = true; let canMoveZ = true; let groundY = 0;

    // AABB 충돌체 루프 (미끄러짐 지원)
    for(let i=0; i<Engine.collidables.length; i++) {
        const box = new THREE.Box3().setFromObject(Engine.collidables[i]);
        
        // 바닥 밟기 판정
        if (Engine.camera.position.x >= box.min.x && Engine.camera.position.x <= box.max.x && 
            Engine.camera.position.z >= box.min.z && Engine.camera.position.z <= box.max.z) {
            if(box.max.y > groundY && box.max.y <= Engine.camera.position.y) groundY = box.max.y;
        }
        
        // 벽 충돌 (X, Z 분리 판정으로 부드럽게 미끄러지도록 함)
        if (Engine.camera.position.y - h < box.max.y && Engine.camera.position.y > box.min.y) {
            if (Engine.camera.position.z + r > box.min.z && Engine.camera.position.z - r < box.max.z) {
                if (nextX + r > box.min.x && nextX - r < box.max.x) canMoveX = false;
            }
            if (Engine.camera.position.x + r > box.min.x && Engine.camera.position.x - r < box.max.x) {
                if (nextZ + r > box.min.z && nextZ - r < box.max.z) canMoveZ = false;
            }
        }
    }

    if(canMoveX) Engine.camera.position.x = nextX; else Engine.velocity.x = 0;
    if(canMoveZ) Engine.camera.position.z = nextZ; else Engine.velocity.z = 0;

    // 점프 적용 및 바닥 착지
    if(Engine.input.jump && Engine.canJump) {
        Engine.velocity.y = 15;
        Engine.canJump = false;
        Engine.input.jump = false; // 1회 소비
    }

    Engine.camera.position.y += Engine.velocity.y * delta;
    if (Engine.camera.position.y < groundY + h) { 
        Engine.velocity.y = 0; 
        Engine.camera.position.y = groundY + h; 
        Engine.canJump = true; 
    }

    // 마우스/터치 시야 회전 (Look)
    if(Engine.lookDelta.x !== 0 || Engine.lookDelta.y !== 0) {
        euler.setFromQuaternion(Engine.camera.quaternion);
        const sens = Engine.input.aim ? 0.001 : 0.003;
        euler.y -= Engine.lookDelta.x * sens;
        euler.x -= Engine.lookDelta.y * sens;
        euler.x = Math.max(-PI_2, Math.min(PI_2, euler.x));
        Engine.camera.quaternion.setFromEuler(euler);
        Engine.lookDelta.x = 0; Engine.lookDelta.y = 0; // 프레임당 소비
    }
}

// ==========================================
// 7. 엔진 메인 셋업
// ==========================================
export function startEngine(container) {
    Engine.scene = new THREE.Scene();
    Engine.scene.background = new THREE.Color(0x0b0c10);
    Engine.scene.fog = new THREE.Fog(0x0b0c10, 10, 200);

    Engine.camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.1, 1000);
    Engine.camera.rotation.order = 'YXZ';

    Engine.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    Engine.renderer.setSize(window.innerWidth, window.innerHeight);
    Engine.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    Engine.renderer.shadowMap.enabled = true;
    Engine.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(Engine.renderer.domElement);

    const renderScene = new RenderPass(Engine.scene, Engine.camera);
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
    Engine.composer = new EffectComposer(Engine.renderer);
    Engine.composer.addPass(renderScene); Engine.composer.addPass(bloomPass);

    Engine.scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const dl = new THREE.DirectionalLight(0x66fcf1, 0.8); 
    dl.position.set(50, 100, 30); dl.castShadow = true;
    dl.shadow.camera.near = 0.5; dl.shadow.camera.far = 250;
    const d = 100; dl.shadow.camera.left = -d; dl.shadow.camera.right = d; dl.shadow.camera.top = d; dl.shadow.camera.bottom = -d;
    Engine.scene.add(dl);

    buildArenaMap();
    
    // 브라우저 리사이즈 
    window.addEventListener('resize', () => {
        Engine.camera.aspect = window.innerWidth / window.innerHeight;
        Engine.camera.updateProjectionMatrix();
        Engine.renderer.setSize(window.innerWidth, window.innerHeight);
        Engine.composer.setSize(window.innerWidth, window.innerHeight);
    });
}
