(function () {
  "use strict";

  var root = document.documentElement;
  document.getElementById("theme-toggle").addEventListener("click", function () {
    var cur = root.getAttribute("data-theme");
    var next = cur === "dark" ? "light" : cur === "light" ? null : "dark";
    if (next) root.setAttribute("data-theme", next); else root.removeAttribute("data-theme");
    scene.background = new THREE.Color(bgColor());
  });

  function b64ToFloat32(b64) {
    var bin = atob(b64), len = bin.length, bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return new Float32Array(bytes.buffer);
  }
  var D = window.SCENE_DATA;
  var cordPos = b64ToFloat32(D.cord_pos_b64), cordNorm = b64ToFloat32(D.cord_norm_b64);
  var placentaPos = b64ToFloat32(D.placenta_pos_b64), placentaNorm = b64ToFloat32(D.placenta_norm_b64);
  var uvPos = b64ToFloat32(D.uv_pos_b64), UV_N = D.uv_n;
  var ua1Pos = b64ToFloat32(D.ua1_pos_b64), UA1_N = D.ua1_n;
  var ua2Pos = b64ToFloat32(D.ua2_pos_b64), UA2_N = D.ua2_n;

  function arcLength(pos, n) {
    var total = 0;
    for (var i = 0; i < n - 1; i++) {
      var dx = pos[(i + 1) * 3] - pos[i * 3], dy = pos[(i + 1) * 3 + 1] - pos[i * 3 + 1], dz = pos[(i + 1) * 3 + 2] - pos[i * 3 + 2];
      total += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    return total;
  }
  var uvArc = arcLength(uvPos, UV_N);
  var ua1Arc = arcLength(ua1Pos, UA1_N);
  var straightUV = Math.hypot(uvPos[0] - uvPos[(UV_N - 1) * 3], uvPos[1] - uvPos[(UV_N - 1) * 3 + 1], uvPos[2] - uvPos[(UV_N - 1) * 3 + 2]);

  var metaHtml = "";
  function metaRow(k, v, flag) {
    metaHtml += '<div class="k">' + k + '</div><div class="v num' + (flag ? " flag" : "") + '">' + v + "</div>";
  }
  metaRow("UV arc length", uvArc.toFixed(1) + " mm", true);
  metaRow("UV straight-line", straightUV.toFixed(1) + " mm", true);
  metaRow("UA #1 trunk length", ua1Arc.toFixed(1) + " mm");
  metaRow("Radii (UV / UA)", D.meta.uv_radius_mm.toFixed(2) + " / " + D.meta.ua_radius_mm.toFixed(2) + " mm");
  metaRow("Target GA", D.meta.target_ga + " wk");
  document.getElementById("meta-grid").innerHTML = metaHtml;

  // ---------------------------------------------------------------------
  // scene setup
  // ---------------------------------------------------------------------
  var viewportEl = document.getElementById("viewport");
  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 20000);
  var renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  viewportEl.appendChild(renderer.domElement);

  function bgColor() {
    var isLight = root.getAttribute("data-theme") === "light" ||
      (!root.getAttribute("data-theme") && window.matchMedia("(prefers-color-scheme: light)").matches);
    return isLight ? 0xeef2f4 : 0x0c1119;
  }
  scene.background = new THREE.Color(bgColor());
  scene.add(new THREE.HemisphereLight(0xdfeaf0, 0x151b23, 1.05));
  var key = new THREE.DirectionalLight(0xffffff, 1.2); key.position.set(300, 400, 300); scene.add(key);
  var rim = new THREE.DirectionalLight(0xbfe0ff, 0.4); rim.position.set(-300, -150, -250); scene.add(rim);

  // combined bounding box (cord + placenta dominate scale)
  var allPos = new Float32Array(cordPos.length + placentaPos.length);
  allPos.set(cordPos, 0); allPos.set(placentaPos, cordPos.length);
  var bboxGeo = new THREE.BufferGeometry();
  bboxGeo.setAttribute("position", new THREE.BufferAttribute(allPos, 3));
  bboxGeo.computeBoundingBox();
  var bbox = bboxGeo.boundingBox;
  var size = new THREE.Vector3(); bbox.getSize(size);
  var center = new THREE.Vector3(); bbox.getCenter(center);
  var maxDim = Math.max(size.x, size.y, size.z);

  function recenter(arr, n) {
    var out = new Float32Array(arr.length);
    for (var i = 0; i < n; i++) {
      out[i * 3] = arr[i * 3] - center.x; out[i * 3 + 1] = arr[i * 3 + 1] - center.y; out[i * 3 + 2] = arr[i * 3 + 2] - center.z;
    }
    return out;
  }
  var cordPosC = recenter(cordPos, cordPos.length / 3);
  var placentaPosC = recenter(placentaPos, placentaPos.length / 3);
  var uvPosC = recenter(uvPos, UV_N);
  var ua1PosC = recenter(ua1Pos, UA1_N);
  var ua2PosC = recenter(ua2Pos, UA2_N);

  // --- surface meshes (cord, placenta): non-indexed triangle soup ---
  function buildSurfaceMesh(pos, norm, color, opacity) {
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(norm, 3));
    var mat = new THREE.MeshStandardMaterial({
      color: color, roughness: 0.55, metalness: 0.03, side: THREE.DoubleSide,
      transparent: true, opacity: opacity, depthWrite: false,
    });
    return new THREE.Mesh(geo, mat);
  }
  var cordMesh = buildSurfaceMesh(cordPosC, cordNorm, 0xc9a876, 0.35);
  var placentaMesh = buildSurfaceMesh(placentaPosC, placentaNorm, 0x8b2f2f, 0.45);
  scene.add(cordMesh); scene.add(placentaMesh);

  // --- centreline tubes (UV, UA1, UA2): reuse Bishop-frame tube builder ---
  function bishopFrame(pos, n) {
    var T = new Float32Array(n * 3), N = new Float32Array(n * 3), B = new Float32Array(n * 3);
    for (var i = 0; i < n - 1; i++) {
      var ax = pos[(i + 1) * 3] - pos[i * 3], ay = pos[(i + 1) * 3 + 1] - pos[i * 3 + 1], az = pos[(i + 1) * 3 + 2] - pos[i * 3 + 2];
      var len = Math.hypot(ax, ay, az) || 1e-9;
      T[i * 3] = ax / len; T[i * 3 + 1] = ay / len; T[i * 3 + 2] = az / len;
    }
    T[(n - 1) * 3] = T[(n - 2) * 3]; T[(n - 1) * 3 + 1] = T[(n - 2) * 3 + 1]; T[(n - 1) * 3 + 2] = T[(n - 2) * 3 + 2];
    var ref = Math.abs(T[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
    var t0 = [T[0], T[1], T[2]];
    var dot0 = ref[0]*t0[0]+ref[1]*t0[1]+ref[2]*t0[2];
    var n0 = [ref[0]-dot0*t0[0], ref[1]-dot0*t0[1], ref[2]-dot0*t0[2]];
    var nlen = Math.hypot(n0[0],n0[1],n0[2]) || 1e-9;
    N[0]=n0[0]/nlen; N[1]=n0[1]/nlen; N[2]=n0[2]/nlen;
    function cross(a,b){ return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
    var b0 = cross(t0, [N[0],N[1],N[2]]); B[0]=b0[0]; B[1]=b0[1]; B[2]=b0[2];
    for (var i2 = 0; i2 < n - 1; i2++) {
      var ta=[T[i2*3],T[i2*3+1],T[i2*3+2]], tb=[T[(i2+1)*3],T[(i2+1)*3+1],T[(i2+1)*3+2]];
      var v = cross(ta, tb); var s = Math.hypot(v[0],v[1],v[2]); var c = ta[0]*tb[0]+ta[1]*tb[1]+ta[2]*tb[2];
      var Ncur=[N[i2*3],N[i2*3+1],N[i2*3+2]], Nnext;
      if (s < 1e-9) { Nnext = Ncur; }
      else {
        var axis=[v[0]/s,v[1]/s,v[2]/s]; var angle = Math.atan2(s, c); var cosA=Math.cos(angle), sinA=Math.sin(angle);
        var crossAN = cross(axis, Ncur); var dotAN = axis[0]*Ncur[0]+axis[1]*Ncur[1]+axis[2]*Ncur[2];
        Nnext = [Ncur[0]*cosA + crossAN[0]*sinA + axis[0]*dotAN*(1-cosA),
                 Ncur[1]*cosA + crossAN[1]*sinA + axis[1]*dotAN*(1-cosA),
                 Ncur[2]*cosA + crossAN[2]*sinA + axis[2]*dotAN*(1-cosA)];
        var dTn = Nnext[0]*tb[0]+Nnext[1]*tb[1]+Nnext[2]*tb[2];
        Nnext = [Nnext[0]-dTn*tb[0], Nnext[1]-dTn*tb[1], Nnext[2]-dTn*tb[2]];
        var nl = Math.hypot(Nnext[0],Nnext[1],Nnext[2]) || 1e-9;
        Nnext = [Nnext[0]/nl, Nnext[1]/nl, Nnext[2]/nl];
      }
      N[(i2+1)*3]=Nnext[0]; N[(i2+1)*3+1]=Nnext[1]; N[(i2+1)*3+2]=Nnext[2];
      var bnext = cross(tb, Nnext); B[(i2+1)*3]=bnext[0]; B[(i2+1)*3+1]=bnext[1]; B[(i2+1)*3+2]=bnext[2];
    }
    return { T: T, N: N, B: B };
  }

  var RADIAL_SEG = 10;
  function buildTube(pos, n, radius, colorHex) {
    var frame = bishopFrame(pos, n);
    var positions = new Float32Array(n * RADIAL_SEG * 3);
    var normals = new Float32Array(n * RADIAL_SEG * 3);
    for (var i = 0; i < n; i++) {
      var nx = frame.N[i*3], ny = frame.N[i*3+1], nz = frame.N[i*3+2];
      var bx = frame.B[i*3], by = frame.B[i*3+1], bz = frame.B[i*3+2];
      for (var j = 0; j < RADIAL_SEG; j++) {
        var ang = (2 * Math.PI * j) / RADIAL_SEG, ca = Math.cos(ang), sa = Math.sin(ang);
        var ox = ca * nx + sa * bx, oy = ca * ny + sa * by, oz = ca * nz + sa * bz;
        var idx = (i * RADIAL_SEG + j) * 3;
        positions[idx] = pos[i*3] + radius * ox; positions[idx+1] = pos[i*3+1] + radius * oy; positions[idx+2] = pos[i*3+2] + radius * oz;
        normals[idx] = ox; normals[idx+1] = oy; normals[idx+2] = oz;
      }
    }
    var indices = [];
    for (var i2 = 0; i2 < n - 1; i2++) {
      for (var j2 = 0; j2 < RADIAL_SEG; j2++) {
        var a = i2 * RADIAL_SEG + j2, b = i2 * RADIAL_SEG + (j2+1) % RADIAL_SEG;
        var c = (i2+1) * RADIAL_SEG + j2, d = (i2+1) * RADIAL_SEG + (j2+1) % RADIAL_SEG;
        indices.push(a, c, b, b, c, d);
      }
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geo.setIndex(indices);
    var mat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.4, metalness: 0.05, side: THREE.DoubleSide });
    return new THREE.Mesh(geo, mat);
  }

  var UV_RADIUS = Math.max(2.5, maxDim * 0.01);
  var UA_RADIUS = UV_RADIUS * 0.55;
  var uvMesh = buildTube(uvPosC, UV_N, UV_RADIUS, 0x2dc7b4);
  var ua1Mesh = buildTube(ua1PosC, UA1_N, UA_RADIUS, 0xe8a13d);
  var ua2Mesh = buildTube(ua2PosC, UA2_N, UA_RADIUS, 0xe8a13d);
  scene.add(uvMesh); scene.add(ua1Mesh); scene.add(ua2Mesh);

  var layers = { cord: cordMesh, placenta: placentaMesh, uv: uvMesh, ua1: ua1Mesh, ua2: ua2Mesh };

  document.querySelectorAll("[data-layer]").forEach(function (cb) {
    cb.addEventListener("change", function () { layers[cb.dataset.layer].visible = cb.checked; });
  });
  document.querySelectorAll("[data-opacity]").forEach(function (sl) {
    sl.addEventListener("input", function () { layers[sl.dataset.opacity].material.opacity = sl.value / 100; });
  });

  // ---------------------------------------------------------------------
  // camera orbit controls
  // ---------------------------------------------------------------------
  var camState = { az: 0.6, pol: 1.15, radius: maxDim * 1.7, target: new THREE.Vector3(0, 0, 0) };
  var dragging = false, lastX = 0, lastY = 0;
  viewportEl.addEventListener("pointerdown", function (e) {
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    viewportEl.classList.add("dragging"); viewportEl.setPointerCapture(e.pointerId);
  });
  viewportEl.addEventListener("pointermove", function (e) {
    if (!dragging) return;
    var dx = e.clientX - lastX, dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY;
    camState.az -= dx * 0.0055;
    camState.pol = Math.max(0.12, Math.min(Math.PI - 0.12, camState.pol - dy * 0.0055));
  });
  window.addEventListener("pointerup", function () { dragging = false; viewportEl.classList.remove("dragging"); });
  viewportEl.addEventListener("wheel", function (e) {
    e.preventDefault();
    camState.radius = Math.max(maxDim * 0.15, Math.min(maxDim * 6, camState.radius * (1 + e.deltaY * 0.0012)));
  }, { passive: false });

  function updateCamera() {
    var r = camState.radius, az = camState.az, pol = camState.pol;
    camera.position.set(camState.target.x + r * Math.sin(pol) * Math.sin(az),
                         camState.target.y + r * Math.cos(pol),
                         camState.target.z + r * Math.sin(pol) * Math.cos(az));
    camera.lookAt(camState.target);
  }
  window.addEventListener("resize", function () {
    camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  (function animate() {
    requestAnimationFrame(animate);
    updateCamera();
    renderer.render(scene, camera);
  })();
})();
