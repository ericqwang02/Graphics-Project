// Last edited by Eric Wang 2025
const SHADOW_VSHADER = `
    uniform mat4 u_LightMVP;
    attribute vec3 a_Position;
    
    void main() {
        gl_Position = u_LightMVP * vec4(a_Position, 1.0);
    }
`;

const SHADOW_FSHADER = `
    precision mediump float;
    
    void main() {
        // depth stored as RGB
        gl_FragColor = vec4(gl_FragCoord.z, 0.0, 0.0, 1.0);
    }
`;
const VSHADER_SOURCE = `
    uniform mat4 u_Model;
    uniform mat4 u_World;
    uniform mat4 u_Camera;
    uniform mat4 u_Projection;

    attribute vec3 a_Position;
    attribute vec3 a_Color;
    attribute vec2 a_TexCoord;
    attribute vec3 a_Normal;

    varying vec3 v_Color;
    varying vec2 v_TexCoord;
    varying vec3 v_Normal; // new
    varying vec3 v_WorldPos;


    void main() {
        gl_Position = u_Projection * u_Camera * u_World * u_Model * vec4(a_Position, 1.0);
        v_Color = a_Color;
        v_TexCoord = a_TexCoord;

        vec4 worldPos = u_World * u_Model * vec4(a_Position, 1.0);
        v_Normal = mat3(u_World * u_Model) * a_Normal; 
        v_WorldPos = worldPos.xyz;

    }
`

const FSHADER_SOURCE = `
    precision mediump float;
    uniform bool u_UseTexture;
    uniform sampler2D u_Sampler;
    uniform sampler2D u_ShadowMap;

    uniform mat4 u_ModelWorldInverseTranspose;
    uniform vec3 u_LightPos;
    uniform mat4 u_LightMVP;
    uniform bool u_IsSunVisible;

    varying vec3 v_Color;
    varying vec2 v_TexCoord;
    varying vec3 v_Normal;
    varying vec3 v_WorldPos;

    float unpackDepth(vec4 rgbaDepth) {
        return rgbaDepth.r;
    }

    float calcShadow(vec3 worldPos) {
        vec4 lightSpacePos = u_LightMVP * vec4(worldPos, 1.0);
        vec3 projCoords = lightSpacePos.xyz / lightSpacePos.w;
        projCoords = projCoords * 0.5 + 0.5;
        
        // check shadow map bounds
        if(projCoords.x < 0.0 || projCoords.x > 1.0 || 
           projCoords.y < 0.0 || projCoords.y > 1.0 ||
           projCoords.z > 1.0) {
            return 1.0;
        }
        
        float closestDepth = unpackDepth(texture2D(u_ShadowMap, projCoords.xy));
        float currentDepth = projCoords.z;
        
        float bias = 0.005;
        float shadow = 0.0;
        vec2 texelSize = vec2(1.0 / 2048.0, 1.0 / 2048.0);
        for(int x = -1; x <= 1; x++) {
            for(int y = -1; y <= 1; y++) {
                float depth = unpackDepth(texture2D(u_ShadowMap, projCoords.xy + vec2(x, y) * texelSize));
                shadow += currentDepth - bias > depth ? 0.0 : 1.0;
            }
        }
        shadow /= 9.0;
        
        return shadow;
    }

    void main() {
        vec3 worldNormal = normalize(vec3(u_ModelWorldInverseTranspose * vec4(v_Normal, 0.0)));

        // point light
        vec3 L = u_LightPos - v_WorldPos;
        float dist = length(L);
        L = normalize(L);

        float attenuation = 1.0 / (1.0 + 0.05 * dist + 0.005 * dist * dist);
        float ndotl = max(dot(worldNormal, L), 0.0);

        vec3 lightColor = vec3(1.0, 0.875, 0.133);
        vec3 litColor = v_Color * lightColor * ndotl * attenuation;
        
        float shadow = calcShadow(v_WorldPos);

        float brightness = 1.5;
        vec3 diffuse = vec3(ndotl * attenuation * brightness) * shadow;
        vec3 ambient = u_IsSunVisible ? vec3(0.4, 0.4, 0.4) : vec3(0.05, 0.05, 0.05);

        vec4 baseColor;

        if (u_UseTexture) {
            baseColor = texture2D(u_Sampler, v_TexCoord);
            gl_FragColor = baseColor;
        } else {
            baseColor = vec4(v_Color, 1.0);
            gl_FragColor = vec4(baseColor.rgb * (ambient + diffuse), baseColor.a);
        }
    }
`

// Global reference to the webGL context and the canvas
let g_canvas;
let gl;

// Global to keep track of the time of the _previous_ frame
let g_lastFrameMS = 0;

// Globals to track if the given list of keys are pressed
let g_keysPressed = {};
const KEYS_TO_TRACK = ['w', 'a', 's', 'd', 'r', 'f', 'k', 'l'];

// Object information
let g_archMesh;
let g_sunMesh;
let g_bodyMesh;
let g_propMesh;

// Normals
let g_archNormals;
let g_sunNormals;
let g_bodyNormals;
let g_propNormals;

// Transformations
let g_archMatrix;
let g_sunMatrix;
let g_propMatrix;
let g_bodyMatrix;

// Orthographic vs projection
// let g_isPerspective = false;
// let g_orthoMatrix;
let g_perspectiveMatrix;

// Colors
let g_archColors;
let g_sunColors;
let g_propColors;
let p_bodyColors;

// GLSL uniform references
let g_uModel_ref;
let g_uWorld_ref;
let g_uProjection_ref;

let g_uLightFactor;

// Usual Matrices
let g_modelMatrix;
let g_worldMatrix;

// Current axis of object rotation
let g_rotationAxis;

// Keep track of the camera position, always looking at the model
// NO MORE!!
// let g_cameraDistance;
// let g_cameraAngle;
// let g_cameraHeight;

let camPos;
let camYaw;
let camPitch;

// for focusing on models
let camFocusing = false;
let targetDeltaYaw;
let targetDeltaPitch;

// driving
let drivingMode = false;
let W;
let D;

let g_sunSpeedMultiplier = 1.0;

// Grid definitions
let g_gridMesh;

// Terrain
let g_terrainMesh;
let g_terrainColors;
let g_terrainMatrix;
let g_terrainWorldMatrix;

let g_heightMap;
let g_normalMap;

let g_terrainNormals;

// Shadow mapping
let g_shadowFramebuffer;
let g_shadowTexture;
let g_shadowProgram;
let g_uLightMVP;
let g_uShadowMap;
const SHADOW_MAP_SIZE = 2048;

let g_uIsSunVisible;

// The size in bytes of a floating point
const FLOAT_SIZE = 4;

function main() {
    // Keep track of time each frame by starting with our current time
    g_lastFrameMS = Date.now();

    g_canvas = document.getElementById('canvas');

    document.getElementById("toggleGridBtn").addEventListener("click", () => {
        g_showGrid = !g_showGrid;
        console.log("Grid " + (g_showGrid ? "enabled" : "disabled"));
    });

    document.getElementById("focusArchBtn").addEventListener("click", () => {
        console.log("Focused on Arch");
        const archPos = [
            g_archMatrix.elements[12],
            g_archMatrix.elements[13] + 2.0, // so it doesn't focus on bottom of arch
            g_archMatrix.elements[14]
        ];

        const [yaw, pitch] = computeYawPitchToTarget(archPos);
        targetDeltaYaw = yaw;
        targetDeltaPitch = pitch;
        camFocusing = true;
    });

    document.getElementById("focusPlaneBtn").addEventListener("click", () => {
        console.log("Focused on Plane");
        const planePos = [
            g_bodyMatrix.elements[12],
            g_bodyMatrix.elements[13],
            g_bodyMatrix.elements[14]
        ];

        const [yaw, pitch] = computeYawPitchToTarget(planePos);
        targetDeltaYaw = yaw;
        targetDeltaPitch = pitch;
        camFocusing = true;
    });

    document.getElementById("driveModeBtn").addEventListener("click", () => {
        console.log("Driving mode " + (drivingMode ? "enabled" : "disabled"));
        drivingMode = !drivingMode;
        camFocusing = false;
    });

    document.getElementById("sunSpeedSlider").addEventListener("input", (event) => {
        g_sunSpeedMultiplier = event.target.value / 100.0;
        document.getElementById("sunSpeedValue").textContent = g_sunSpeedMultiplier.toFixed(1) + "x";
        console.log("Sun speed set to " + g_sunSpeedMultiplier.toFixed(1) + "x");
    });

    // Get the rendering context for WebGL
    gl = getWebGLContext(g_canvas, true);
    if (!gl) {
        console.log('Failed to get the rendering context for WebGL');
        return;
    }

    // Setup our reactions from keys
    setupKeyBinds();

    // We will call this at the end of most main functions from now on
    loadOBJFiles();
}

/*
 * Helper function to load OBJ files in sequence
 * For much larger files, you may are welcome to make this more parallel
 * I made everything sequential for this class to make the logic easier to follow
 */
async function loadOBJFiles() {
    // open our OBJ file(s)
    arch_data = await fetch('./resources/archsingle.obj').then(response => response.text()).then((x) => x)
    g_archMesh = [];
    g_archNormals = [];

    // Read the obj mesh
    readObjFile(arch_data, g_archMesh, g_archNormals);
    g_archColors = buildGradientColorAttributes(g_archMesh, [0.65, 0.45, 0.25]);

    sun_data = await fetch('./resources/sphere.obj').then(response => response.text()).then((x) => x)
    // g_sunMesh = [];
    // // Read the obj mesh
    // readObjFile(sun_data, g_sunMesh);
    // g_sunColors = buildGradientColorAttributes(g_sunMesh, [1.0, 0.9, 0.0]);
    g_sunMesh = [];
    g_sunNormals = [];
    g_sunUVs = [];

    readObjFile(sun_data, g_sunMesh, g_sunNormals);
    g_sunUVs = generateSphereUVs(g_sunMesh);

    // sun color should be white so texture shows properly:
    g_sunColors = buildSolidColorAttributes(g_sunMesh.length / 3, [1.0, 1.0, 1.0]);

    plane_data = await fetch('./resources/biplane.obj').then(response => response.text()).then((x) => x)
    let planeMesh = {};
    let planeNormals = {};

    g_propMesh = [];
    g_bodyMesh = [];
    g_propNormals = [];
    g_bodyNormals = [];

    // Read the obj mesh
    readObjFileByGroup(plane_data, planeMesh, planeNormals);
    for (let key in planeMesh) {
        if (key == 'Propeller') {
            g_propMesh = g_propMesh.concat(planeMesh[key]);
            g_propNormals = g_propNormals.concat(planeNormals[key]);
        }
        else {
            g_bodyMesh = g_bodyMesh.concat(planeMesh[key]);
            g_bodyNormals = g_bodyNormals.concat(planeNormals[key]);
        }
    }
    g_bodyColors = buildGradientColorAttributes(g_bodyMesh, [0.1, 0.3, 0.9]);
    g_propColors = buildSolidColorAttributes(g_propMesh.length / 3, [0.2, 0.2, 0.2]);

    // Start our first frame
    startRendering();
}
// my sphere.obj had malformed vts, so i had to make a helper for it.......
function generateSphereUVs(v) {
    const uvs = [];
    for (let i = 0; i < v.length; i += 3) {
        const x = v[i], y = v[i + 1], z = v[i + 2];
        const inv = 1 / Math.hypot(x, y, z);

        const u = 1 - (Math.atan2(z * inv, x * inv) + Math.PI) / (2 * Math.PI);
        const v_ = (Math.asin(y * inv) + Math.PI / 2) / Math.PI;

        uvs.push(u, v_);
    }
    return uvs;
}

// helper to load sun texture
function loadTexture(path) {
    const texture = gl.createTexture();
    const image = new Image();

    image.onload = function () {
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA,
            gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.generateMipmap(gl.TEXTURE_2D);
    };

    image.src = path;
    return texture;
}

function initShadowMap() {
    g_shadowFramebuffer = gl.createFramebuffer();
    if (!g_shadowFramebuffer) {
        console.log('Failed to create framebuffer for shadow map');
        return false;
    }

    // texture for shadow map
    g_shadowTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, g_shadowTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SHADOW_MAP_SIZE, SHADOW_MAP_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    let depthBuffer = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depthBuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);

    gl.bindFramebuffer(gl.FRAMEBUFFER, g_shadowFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, g_shadowTexture, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthBuffer);

    let status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
        console.log('Framebuffer is not complete: ' + status.toString());
        return false;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);

    return true;
}

function startRendering() {
    // Initialize GPU's vertex and fragment shaders programs
    if (!initShaders(gl, VSHADER_SOURCE, FSHADER_SOURCE)) {
        console.log('Failed to intialize shaders.');
        return;
    }

    g_shadowProgram = createProgram(gl, SHADOW_VSHADER, SHADOW_FSHADER);
    if (!g_shadowProgram) {
        console.log('Failed to initialize shadow shaders.');
        return;
    }

    if (!initShadowMap()) {
        console.log('Failed to initialize shadow map');
        return;
    }

    g_sunTexture = loadTexture('./resources/sun_texture.jpg');
    g_uUseTexture = gl.getUniformLocation(gl.program, 'u_UseTexture');
    g_uSampler = gl.getUniformLocation(gl.program, 'u_Sampler');

    // class for building the terrain mesh
    let terrainGenerator = new TerrainGenerator();
    // use the current milliseconds as our seed by default
    // TODO: consider setting this as a constant when testing stuff!
    //   just make sure to change it back to something semi-random before submitting :)
    let seed = new Date().getMilliseconds();

    // Setup the options for our terrain generation
    // TODO: try messing around with these options!  
    //   noisefn and roughness in particular give some interesting results when changed
    let options = {
        width: 400,
        height: 20,
        depth: 400,
        seed: seed,
        noisefn: "perlin", // Other options are "simplex" and "perlin"
        roughness: 10
    };

    W = options.width;
    D = options.depth;

    // construct a terrain mesh of an array of 3-vectors
    // TODO: integrate this with your code!
    let terrain = terrainGenerator.generateTerrainMesh(options);

    g_heightmap = Array(W);
    for (let x = 0; x < W; x++) {
        g_heightmap[x] = Array(D);
    }

    for (let i = 0; i < terrain.length; i++) {
        let [x, y, z] = terrain[i];
        g_heightmap[x][z] = y;
    }

    g_normalmap = Array(W);
    for (let x = 0; x < W; x++) {
        g_normalmap[x] = Array(D);
    }

    // normal calculation
    for (let x = 1; x < W - 1; x++) {
        for (let z = 1; z < D - 1; z++) {
            let hL = g_heightmap[x - 1][z];
            let hR = g_heightmap[x + 1][z];
            let hD = g_heightmap[x][z - 1];
            let hU = g_heightmap[x][z + 1];

            let nx = hL - hR;
            let ny = 2.0;
            let nz = hD - hU;

            let len = Math.hypot(nx, ny, nz);
            g_normalmap[x][z] = [nx / len, ny / len, nz / len];
        }
    }

    // give basic height-based colors based on the 3-vertex specified terrain
    // TODO: make this more interesting (see the function itself)
    let terrainColors = buildTerrainColors(terrain, options.height);
    g_terrainColors = terrainColors;

    // "flatten" the terrain above to construct our usual global mesh
    g_terrainMesh = []
    for (let i = 0; i < terrain.length; i++) {
        g_terrainMesh.push(...terrain[i])
    }

    g_terrainNormals = [];

    for (let i = 0; i < terrain.length; i++) {
        let x = terrain[i][0];
        let z = terrain[i][2];

        // check if a normal exists
        if (x >= 1 && x < W - 1 && z >= 1 && z < D - 1 && g_normalmap[x] && g_normalmap[x][z]) {
            let nx = g_normalmap[x][z][0];
            let ny = g_normalmap[x][z][1];
            let nz = g_normalmap[x][z][2];
            g_terrainNormals.push(nx, ny, nz);
        } else {
            // it is an edge vertex, use default up normal
            g_terrainNormals.push(0, 1, 0);
        }
    }
    // build a grid model with colors
    // TODO: consider using gridColors
    [g_gridMesh, g_gridColors] = buildGridAttributes(1, 1, [0, 1, 0]);

    // Send our data to the GPU
    // modified to add terrain
    let meshes = [].concat(g_terrainMesh, g_archMesh, g_sunMesh, g_bodyMesh, g_propMesh, g_gridMesh);
    let colors = [].concat(g_terrainColors, g_archColors, g_sunColors, g_bodyColors, g_propColors, g_gridColors);
    let normals = [].concat(g_terrainNormals, g_archNormals, g_sunNormals, g_bodyNormals, g_propNormals, new Array(g_gridMesh.length).fill(1));

    // let data = meshes.concat(colors);
    // fill other UVs with 0, since we don't need them
    let allUVs = [].concat(
        new Array(g_terrainMesh.length / 3 * 2).fill(0),
        new Array(g_archMesh.length / 3 * 2).fill(0),
        g_sunUVs,
        new Array(g_bodyMesh.length / 3 * 2).fill(0),
        new Array(g_propMesh.length / 3 * 2).fill(0),
        new Array(g_gridMesh.length / 3 * 2).fill(0)
    );

    let data = meshes.concat(colors, normals, allUVs);
    if (!initVBO(new Float32Array(data))) {
        return;
    }

    // Communicate our data layout to the GPU
    if (!setupVec(3, 'a_Position', 0, 0)) {
        return;
    }
    let colorOffsetBytes = meshes.length * FLOAT_SIZE;
    if (!setupVec(3, 'a_Color', 0, colorOffsetBytes)) {
        return;
    }
    let normalOffsetBytes = (meshes.length + colors.length) * FLOAT_SIZE;
    if (!setupVec(3, 'a_Normal', 0, normalOffsetBytes)) {
        return;
    };
    let uvOffsetBytes = (meshes.length + colors.length + normals.length) * FLOAT_SIZE;
    if (!setupVec(2, 'a_TexCoord', 0, uvOffsetBytes)) {
        return;
    }
    // Get references to GLSL uniforms
    g_uModel_ref = gl.getUniformLocation(gl.program, 'u_Model');
    g_uWorld_ref = gl.getUniformLocation(gl.program, 'u_World');
    g_uCamera_ref = gl.getUniformLocation(gl.program, 'u_Camera');
    g_uProjection_ref = gl.getUniformLocation(gl.program, 'u_Projection');

    g_uLightPos = gl.getUniformLocation(gl.program, 'u_LightPos');
    g_uModelWorldInverseTranspose = gl.getUniformLocation(gl.program, 'u_ModelWorldInverseTranspose');

    g_uLightMVP = gl.getUniformLocation(gl.program, 'u_LightMVP');
    g_uShadowMap = gl.getUniformLocation(gl.program, 'u_ShadowMap');

    g_uIsSunVisible = gl.getUniformLocation(gl.program, 'u_IsSunVisible');


    g_archMatrix = new Matrix4().setTranslate(0, 0, 0.6).scale(4, 4, 4);
    g_sunMatrix = new Matrix4().setTranslate(0, 35, 0).scale(0.2, 0.2, 0.2);
    g_propMatrix = new Matrix4();
    g_bodyMatrix = new Matrix4().setTranslate(0, 8, -10).scale(0.15, 0.20, 0.20);

    // Setup a model and world matrix for our terrain
    // Position can be given by our width/height, 
    //   noting that we are centered initially at the "midpoint"
    // We want to be a bit above the terrain initially so we can see it
    // TODO: resize the terrain as needed to "fit" with your animation
    g_terrainMatrix = new Matrix4().scale(0.05, 0.05, 0.05);
    // move in view of the initial camera
    // TODO: you may want to move your terrain!  This is just placed for the demo
    g_terrainWorldMatrix = new Matrix4().translate(-10, -0.5, -8.5);

    // Place our model in the world
    g_worldMatrix = new Matrix4();

    // Place the camera up a bit
    // g_cameraDistance = 10.0;
    // g_cameraHeight = 0.5;
    // g_cameraAngle = -35.0;
    camPos = [5.5, 2.0, -2.0];
    camYaw = 235.0;
    camPitch = 0.0;

    camTransitioning = false;

    // g_orthoMatrix = new Matrix4().setOrtho(-6, 6, -6, 6, -6, 6);
    g_perspectiveMatrix = new Matrix4().setPerspective(90, 1.0, .1, 50);

    // Enable culling and depth
    gl.enable(gl.CULL_FACE);
    gl.enable(gl.DEPTH_TEST);

    // Setup for ticks
    g_lastFrameMS = Date.now();
    g_rotationAxis = [0, 0, 0];

    tick();
}

// Animation constants
const ROTATION_SPEED = 0.05;
const CAMERA_SPEED = .003;
const CAMERA_ROTATION_SPEED = .1;

// new
const CAMERA_MOVE_SPEED = 0.01;
const PITCH_LIMIT_DEG = 89.0;

// focus on models
const FOCUS_ROTATION_SPEED = 0.005;

// driving
const DRIVE_MOVE_SPEED = 0.004;

const PROP_ROTATION_SPEED = 1;
const SUN_ROTATION_SPEED = 0.08;
const PLANE_SPEED = 0.04;

let g_sunAngle = 0.0;
let g_planeZ = -10;
let isSunVisible = true;
let timeStop = false;
let g_showGrid = false;

// function to apply all the logic for a single frame tick
function tick() {
    // Calculate time since the last frame
    let currentTime = Date.now();
    let deltaMS = currentTime - g_lastFrameMS;
    g_lastFrameMS = currentTime;

    // Rotate around the given axis each frame
    angle = ROTATION_SPEED * deltaMS;
    g_propMatrix.rotate(PROP_ROTATION_SPEED * deltaMS, 0, 0, 1);

    if (!timeStop) {
        g_sunMatrix.rotate(SUN_ROTATION_SPEED * deltaMS * g_sunSpeedMultiplier, 1, 0, 0);
    }
    isSunVisible = g_sunMatrix.elements[13] > 0;

    // focus on object
    if (camFocusing) {
        camYaw += targetDeltaYaw * FOCUS_ROTATION_SPEED * deltaMS;
        camPitch += targetDeltaPitch * FOCUS_ROTATION_SPEED * deltaMS;

        targetDeltaYaw -= targetDeltaYaw * FOCUS_ROTATION_SPEED * deltaMS;
        targetDeltaPitch -= targetDeltaPitch * FOCUS_ROTATION_SPEED * deltaMS;

        if (Math.abs(targetDeltaYaw) < 0.1 && Math.abs(targetDeltaPitch) < 0.1) {
            camFocusing = false;
        }
    }
    // Move the camera based on user input
    // NOTE: when you add projection, you _may_ want to invert these
    if (!camFocusing) {
        if (!drivingMode) {
            if (g_keysPressed['a']) {
                camYaw -= CAMERA_ROTATION_SPEED * deltaMS;
            }
            if (g_keysPressed['d']) {
                camYaw += CAMERA_ROTATION_SPEED * deltaMS;
            }
            if (g_keysPressed['w']) {
                camPitch += CAMERA_ROTATION_SPEED * deltaMS;
            }
            if (g_keysPressed['s']) {
                camPitch -= CAMERA_ROTATION_SPEED * deltaMS;
            }
            if (camPitch > PITCH_LIMIT_DEG) camPitch = PITCH_LIMIT_DEG;
            if (camPitch < -PITCH_LIMIT_DEG) camPitch = -PITCH_LIMIT_DEG;

            // yaw should always stay in [-180, 180]
            camYaw = ((camYaw + 180) % 360) - 180;

            // calculate "forward"
            const yawRad = camYaw * Math.PI / 180.0;
            const pitchRad = camPitch * Math.PI / 180.0;
            const cosPitch = Math.cos(pitchRad);
            const forward = [
                cosPitch * Math.sin(yawRad),
                Math.sin(pitchRad),
                -cosPitch * Math.cos(yawRad)
            ];
            if (g_keysPressed['r']) {
                camPos[0] += forward[0] * (CAMERA_MOVE_SPEED * deltaMS);
                camPos[1] += forward[1] * (CAMERA_MOVE_SPEED * deltaMS);
                camPos[2] += forward[2] * (CAMERA_MOVE_SPEED * deltaMS);
            }
            if (g_keysPressed['f']) {
                camPos[0] -= forward[0] * (CAMERA_MOVE_SPEED * deltaMS);
                camPos[1] -= forward[1] * (CAMERA_MOVE_SPEED * deltaMS);
                camPos[2] -= forward[2] * (CAMERA_MOVE_SPEED * deltaMS);
            }
        } else {
            //driving mode
            if (g_keysPressed['a']) camYaw -= 0.1 * deltaMS;
            if (g_keysPressed['d']) camYaw += 0.1 * deltaMS;

            const yawRad = camYaw * Math.PI / 180;
            const speed = DRIVE_MOVE_SPEED * deltaMS;
            let dx = Math.sin(yawRad);
            let dz = -Math.cos(yawRad);

            if (g_keysPressed['w']) {
                camPos[0] += dx * speed;
                camPos[2] += dz * speed;
            }
            if (g_keysPressed['s']) {
                camPos[0] -= dx * speed;
                camPos[2] -= dz * speed;
            }

            // height calculation
            const h = getHeight(camPos[0], camPos[2]);
            camPos[1] = h + 1.2;

            // pitch calculation
            const N = getNormal(camPos[0], camPos[2]);
            const slope = Math.acos(N[1]) * 180 / Math.PI;
            const pitch = slope * 0.8; // 0.8 is to reduce bumpiness of driving
            camPitch += (pitch - camPitch) * 0.1;
        }
        if (g_keysPressed['k']) {
            g_planeZ += PLANE_SPEED * deltaMS;
            g_bodyMatrix.setTranslate(0, 8, g_planeZ).scale(0.15, 0.20, 0.20);
        }
        if (g_keysPressed['l']) {
            g_planeZ -= PLANE_SPEED * deltaMS;
            g_bodyMatrix.setTranslate(0, 8, g_planeZ).scale(0.15, 0.20, 0.20);
        }
    }
    timeStop = g_planeZ > 10
    draw();

    // Call tick next frame
    requestAnimationFrame(tick, g_canvas);
}
// 
function getHeight(x, z) {
    const scale = 0.05;

    const tx = g_terrainWorldMatrix.elements[12];
    const ty = g_terrainWorldMatrix.elements[13];
    const tz = g_terrainWorldMatrix.elements[14];

    const lx = (x - tx) / scale;
    const lz = (z - tz) / scale;

    const ix = Math.floor(lx);
    const iz = Math.floor(lz);

    // out of bounds check
    if (ix < 0 || iz < 0 || ix >= W - 1 || iz >= D - 1) return ty;

    const fx = lx - ix;
    const fz = lz - iz;

    const h00 = g_heightmap[ix][iz];
    const h10 = g_heightmap[ix + 1][iz];
    const h01 = g_heightmap[ix][iz + 1];
    const h11 = g_heightmap[ix + 1][iz + 1];

    // bilinear interp
    const h0 = h00 + (h10 - h00) * fx;
    const h1 = h01 + (h11 - h01) * fx;
    const h = h0 + (h1 - h0) * fz;

    return h * scale + ty;
}
function getNormal(x, z) {
    const scale = 0.05;

    const tx = g_terrainWorldMatrix.elements[12];
    const tz = g_terrainWorldMatrix.elements[14];

    const lx = (x - tx) / scale;
    const lz = (z - tz) / scale;

    const ix = Math.floor(lx);
    const iz = Math.floor(lz);

    if (ix < 1 || iz < 1 || ix >= W - 1 || iz >= D - 1)
        return [0, 1, 0];

    return g_normalmap[ix][iz];
}

// helper to compute yaw and pitch to a target position (used for arch and plane)
function computeYawPitchToTarget(targetPos) {
    const dx = targetPos[0] - camPos[0];
    const dy = targetPos[1] - camPos[1];
    const dz = targetPos[2] - camPos[2];

    const desiredYaw = Math.atan2(dx, -dz) * 180 / Math.PI;
    const desiredPitch = Math.atan2(dy, Math.sqrt(dx * dx + dz * dz)) * 180 / Math.PI;

    const normDesiredYaw = ((desiredYaw % 360) + 360) % 360;

    let deltaYaw = normDesiredYaw - camYaw;
    deltaYaw = ((deltaYaw + 180) % 360) - 180;

    const deltaPitch = desiredPitch - camPitch;

    return [deltaYaw, deltaPitch];
}

function renderShadowMap() {
    // switch to shadow shader program
    gl.useProgram(g_shadowProgram);

    // position attribute for shadow shader
    let a_Position_shadow = gl.getAttribLocation(g_shadowProgram, 'a_Position');
    gl.vertexAttribPointer(a_Position_shadow, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(a_Position_shadow);

    // bind shadow framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, g_shadowFramebuffer);
    gl.viewport(0, 0, SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    let lightPos = new Vector3([
        g_sunMatrix.elements[12],
        g_sunMatrix.elements[13],
        g_sunMatrix.elements[14]
    ]);

    let lightTarget = new Vector3([0, 0, 0]);
    let lightUp = new Vector3([0, 1, 0]);

    let lightView = new Matrix4().setLookAt(lightPos, lightTarget, lightUp);

    let lightProjection = new Matrix4().setPerspective(90, 1.0, 1.0, 100.0);
    let lightMVP = new Matrix4(lightProjection).multiply(lightView);

    let u_LightMVP_shadow = gl.getUniformLocation(g_shadowProgram, 'u_LightMVP');

    const terrainVerts = g_terrainMesh.length / 3;
    const archVerts = g_archMesh.length / 3;
    const bodyVerts = g_bodyMesh.length / 3;
    const propVerts = g_propMesh.length / 3;

    // Terrain
    let terrainMVP = new Matrix4(lightMVP).multiply(g_terrainWorldMatrix).multiply(g_terrainMatrix);
    gl.uniformMatrix4fv(u_LightMVP_shadow, false, terrainMVP.elements);
    gl.drawArrays(gl.TRIANGLES, 0, terrainVerts);

    // Arch
    let archStart = terrainVerts;
    let archMVP = new Matrix4(lightMVP).multiply(g_worldMatrix).multiply(g_archMatrix);
    gl.uniformMatrix4fv(u_LightMVP_shadow, false, archMVP.elements);
    gl.drawArrays(gl.TRIANGLES, archStart, archVerts);

    // Plane body
    let bodyStart = archStart + archVerts + g_sunMesh.length / 3;
    let bodyMVP = new Matrix4(lightMVP).multiply(g_worldMatrix).multiply(g_bodyMatrix);
    gl.uniformMatrix4fv(u_LightMVP_shadow, false, bodyMVP.elements);
    gl.drawArrays(gl.TRIANGLES, bodyStart, bodyVerts);

    // Propeller
    let propStart = bodyStart + bodyVerts;
    let propellerMatrix = new Matrix4(g_bodyMatrix).multiply(g_propMatrix);
    let propMVP = new Matrix4(lightMVP).multiply(g_worldMatrix).multiply(propellerMatrix);
    gl.uniformMatrix4fv(u_LightMVP_shadow, false, propMVP.elements);
    gl.drawArrays(gl.TRIANGLES, propStart, propVerts);

    // Restore default framebuffer and viewport
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, g_canvas.width, g_canvas.height);

    // Switch back to main shader program
    gl.useProgram(gl.program);

    return lightMVP;
}

function draw() {
    let lightMVP = renderShadowMap();

    gl.clearColor(0.05, 0.05, 0.05, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Bind shadow map texture
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, g_shadowTexture);
    gl.uniform1i(gl.getUniformLocation(gl.program, 'u_ShadowMap'), 1);

    // Pass light MVP to main shader
    gl.uniformMatrix4fv(g_uLightMVP, false, lightMVP.elements);

    gl.uniform1i(g_uIsSunVisible, isSunVisible);

    // Update the camera matrix each frame based on camera values
    // Note that everything will (usually) use the same camera matrix
    // So we can just put all that here
    let cameraMatrix = calculateCameraMatrix();

    let projectionMatrix = g_perspectiveMatrix;
    // if (g_isPerspective) {
    //     projectionMatrix = g_perspectiveMatrix;
    // } else {
    //     projectionMatrix = g_orthoMatrix;
    // }
    gl.uniformMatrix4fv(g_uProjection_ref, false, projectionMatrix.elements);
    gl.uniformMatrix4fv(g_uCamera_ref, false, cameraMatrix.elements);

    const archVerts = g_archMesh.length / 3;
    const sunVerts = g_sunMesh.length / 3;
    const bodyVerts = g_bodyMesh.length / 3;
    const propVerts = g_propMesh.length / 3;
    const terrainVerts = g_terrainMesh.length / 3;

    // Draw terrain
    let terrainModelWorld = new Matrix4(g_terrainWorldMatrix).multiply(g_terrainMatrix);
    let terrainInvTranspose = new Matrix4(terrainModelWorld).invert().transpose();
    gl.uniformMatrix4fv(g_uModelWorldInverseTranspose, false, terrainInvTranspose.elements);
    gl.uniformMatrix4fv(g_uModel_ref, false, g_terrainMatrix.elements);
    gl.uniformMatrix4fv(g_uWorld_ref, false, g_terrainWorldMatrix.elements);
    gl.drawArrays(gl.TRIANGLES, 0, terrainVerts);

    // Draw arch
    let archStart = terrainVerts;
    let archModelWorld = new Matrix4(g_worldMatrix).multiply(g_archMatrix);
    let archInvTranspose = new Matrix4(archModelWorld).invert().transpose();
    gl.uniformMatrix4fv(g_uModelWorldInverseTranspose, false, archInvTranspose.elements);
    gl.uniformMatrix4fv(g_uModel_ref, false, g_archMatrix.elements);
    gl.uniformMatrix4fv(g_uWorld_ref, false, g_worldMatrix.elements);
    gl.drawArrays(gl.TRIANGLES, archStart, archVerts);

    // Draw sun
    let sunStart = archStart + archVerts;
    let sunWorldPos = [
        g_sunMatrix.elements[12],
        g_sunMatrix.elements[13],
        g_sunMatrix.elements[14]
    ];
    gl.uniform3fv(g_uLightPos, sunWorldPos);
    if (isSunVisible) {
        let sunModelWorld = new Matrix4(g_worldMatrix).multiply(g_sunMatrix);
        let sunInvTranspose = new Matrix4(sunModelWorld).invert().transpose();
        gl.uniformMatrix4fv(g_uModelWorldInverseTranspose, false, sunInvTranspose.elements);

        gl.uniform1i(g_uUseTexture, true);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, g_sunTexture);
        gl.uniform1i(g_uSampler, 0);

        gl.uniformMatrix4fv(g_uModel_ref, false, g_sunMatrix.elements);
        gl.uniformMatrix4fv(g_uWorld_ref, false, g_worldMatrix.elements);
        gl.drawArrays(gl.TRIANGLES, sunStart, sunVerts);
    }
    gl.uniform1i(g_uUseTexture, false);

    // Draw plane body
    let bodyStart = sunStart + sunVerts;
    let bodyModelWorld = new Matrix4(g_worldMatrix).multiply(g_bodyMatrix);
    let bodyInvTranspose = new Matrix4(bodyModelWorld).invert().transpose();
    gl.uniformMatrix4fv(g_uModelWorldInverseTranspose, false, bodyInvTranspose.elements);
    gl.uniformMatrix4fv(g_uModel_ref, false, g_bodyMatrix.elements);
    gl.drawArrays(gl.TRIANGLES, bodyStart, bodyVerts);

    // Draw plane propeller
    let propStart = bodyStart + bodyVerts;
    let propellerMatrix = new Matrix4(g_bodyMatrix).multiply(g_propMatrix);
    let propModelWorld = new Matrix4(g_worldMatrix).multiply(propellerMatrix);
    let propInvTranspose = new Matrix4(propModelWorld).invert().transpose();
    gl.uniformMatrix4fv(g_uModelWorldInverseTranspose, false, propInvTranspose.elements);
    gl.uniformMatrix4fv(g_uModel_ref, false, propellerMatrix.elements);
    gl.drawArrays(gl.TRIANGLES, propStart, propVerts);

    // Draw grid
    if (g_showGrid) {
        let gridStart = propStart + propVerts;
        let gridModelWorld = new Matrix4(); // Identity matrix
        let gridInvTranspose = new Matrix4(); // Identity matrix
        gl.uniformMatrix4fv(g_uModelWorldInverseTranspose, false, gridInvTranspose.elements);
        gl.uniformMatrix4fv(g_uModel_ref, false, new Matrix4().elements);
        gl.uniformMatrix4fv(g_uWorld_ref, false, new Matrix4().elements);
        gl.drawArrays(gl.LINES, gridStart, g_gridMesh.length / 3);
    }
}

/*
 * Helper to construct _basic_ per-vertex terrain colors
 * We use the height of the terrain to select a color between white and blue
 * Requires that we pass in the height of the terrain (as a number), but feel free to change this
 * TODO: you should expect to modify this helper with custom (or more interesting) colors
 */
function buildTerrainColors(terrain, height) {
    let colors = []
    for (let i = 0; i < terrain.length; i++) {
        // calculates the vertex color for each vertex independent of the triangle
        // the rasterizer can help make this look "smooth"

        // we use the y axis of each vertex alone for color
        // higher "peaks" have more shade

        const y = terrain[i][1];
        const h = Math.max(0, Math.min(1, y / height));

        // grass color layers
        let color;

        if (h < 0.33) {
            color = mixColor([0.10, 0.28, 0.10], [0.15, 0.45, 0.15], h / 0.25);
        }
        else if (h < 0.66) {
            color = mixColor([0.15, 0.45, 0.15], [0.32, 0.70, 0.28], (h - 0.25) / 0.35);
        }
        else {
            color = mixColor([0.32, 0.70, 0.28], [0.55, 0.45, 0.20], (h - 0.6) / 0.4);
        }

        // give each triangle 3 colors
        colors.push(...color)
    }

    return colors
}

// color mixing helper
function mixColor(a, b, t) {
    return [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
    ];
}

/**
 * Helper function to split out the camera math
 * You may want to modify this to have a free-moving camera
 */
function calculateCameraMatrix() {
    // Calculate the camera position from our angle and height
    // we get to use a bit of clever 2D rotation math
    // note that we can only do this because we're "fixing" our plane of motion
    // if we wanted to allow arbitrary rotation, we may also want quaternions

    const yaw = camYaw * Math.PI / 180;
    const pitch = camPitch * Math.PI / 180;

    const forward = new Vector3([
        Math.cos(pitch) * Math.sin(yaw),
        Math.sin(pitch),
        -Math.cos(pitch) * Math.cos(yaw)
    ]);
    const target = new Vector3([
        camPos[0] + forward.elements[0],
        camPos[1] + forward.elements[1],
        camPos[2] + forward.elements[2]
    ]);

    return new Matrix4().setLookAt(
        new Vector3(camPos),
        target,
        new Vector3([0, 1, 0]));
}

/**
 * Helper function to setup key binding logic
 */
function setupKeyBinds() {
    // Setup the dictionary of keys we're tracking
    KEYS_TO_TRACK.forEach(key => {
        g_keysPressed[key] = false;
    });

    // Set key flag to true when key starts being pressed
    document.addEventListener('keydown', function (event) {
        KEYS_TO_TRACK.forEach(key => {
            if (event.key == key) {
                g_keysPressed[key] = true;
            }
        });
    })

    // Set key flag to false when key starts being pressed
    document.addEventListener('keyup', function (event) {
        KEYS_TO_TRACK.forEach(key => {
            if (event.key == key) {
                g_keysPressed[key] = false;
            }
        });
    })

    // Switching between orthgraphic/projections
    // document.addEventListener('keydown', function (event) {
    //     if (event.key == ' ') {
    //         g_isPerspective = !g_isPerspective;
    //         if (g_isPerspective) {
    //             g_cameraDistance = 10.0;
    //         } else {
    //             g_cameraDistance = 1.2;
    //         }
    //         console.log(g_isPerspective ? 'Perspective mode' : 'Orthographic mode');
    //     }
    //     KEYS_TO_TRACK.forEach(key => {
    //         if (event.key == key) g_keysPressed[key] = true;
    //     });
    // });
}

// Grid constants

// How far in the X and Z directions the grid should extend
// Recall that the camera "rests" on the X/Z plane, since Z is "out" from the camera
const GRID_X_RANGE = 1000;
const GRID_Z_RANGE = 1000;

/*
 * Helper to build a grid mesh and colors
 * Returns these results as a pair of arrays
 * Each vertex in the mesh is constructed with an associated grid_color
 */
function buildGridAttributes(grid_row_spacing, grid_column_spacing, grid_color) {
    let mesh = [];
    let colors = [];

    // Construct the rows
    for (let x = -GRID_X_RANGE; x < GRID_X_RANGE; x += grid_row_spacing) {
        // two vertices for each line
        // one at -Z and one at +Z
        mesh.push(x, 0, -GRID_Z_RANGE);
        mesh.push(x, 0, GRID_Z_RANGE);
    }

    // Construct the columns extending "outward" from the camera
    for (let z = -GRID_Z_RANGE; z < GRID_Z_RANGE; z += grid_column_spacing) {
        // two vertices for each line
        // one at -Z and one at +Z
        mesh.push(-GRID_X_RANGE, 0, z);
        mesh.push(GRID_X_RANGE, 0, z);
    }

    // We need one color per vertex
    // since we have 3 components for each vertex, this is length/3
    for (let i = 0; i < mesh.length / 3; i++) {
        colors.push(grid_color[0], grid_color[1], grid_color[2]);
    }

    return [mesh, colors];
}

/**
 * Helper to construct colors to make meshes look more 3D
 * Makes every triangle a slightly different shade of blue
 * @param {int} vertexCount how many vertices to build colors for
 * @returns {Array<float>} a flat array of colors
 */
function buildColorAttributes(vertexCount) {
    let colors = [];
    for (let i = 0; i < vertexCount / 3; i++) {
        // three vertices per triangle
        for (let vert = 0; vert < 3; vert++) {
            let shade = (i * 3) / vertexCount;
            colors.push(shade, shade, 1.0);
        }
    }
    return colors;
}

/**
 * Inspired by helper buildColorAttributes
 * Makes a solid color of any choice
 * @param {int} vertexCount how many vertices to build colors for
 * @param {Array<float>} rgb the solid color
 * @returns {Array<float>} a flat array of colors
 */
function buildSolidColorAttributes(vertexCount, rgb) {
    let colors = [];
    for (let i = 0; i < vertexCount; i++) {
        colors.push(rgb[0], rgb[1], rgb[2]);
    }
    return colors;
}

/**
 * Helper that creates a vertical gradient
 * Since the OBJ files have no specific vertex ordering, we have to color vertexes based on their height
 * @param {Array<float>} mesh the mesh
 * @param {Array<float>} baseColor the rgb to apply a gradient
 * @returns {Array<float>} a flat array of colors
 */
function buildGradientColorAttributes(mesh, baseColor) {
    let colors = [];
    let bottomBrightness = 0.2
    let topBrightness = 1.0

    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < mesh.length; i += 3) {
        const y = mesh[i + 1];
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }

    for (let i = 0; i < mesh.length; i += 3) {
        const y = mesh[i + 1];
        const heightFactor = (y - minY) / (maxY - minY + 1e-6);
        const brightness = bottomBrightness + (topBrightness - bottomBrightness) * heightFactor;
        colors.push(baseColor[0] * brightness, baseColor[1] * brightness, baseColor[2] * brightness);
    }

    return colors;
}


/**
 * Initialize the VBO with the provided data
 * Assumes we are going to have "static" (unchanging) data
 * @param {Float32Array} data 
 * @return {Boolean} true if the VBO was setup successfully, and false otherwise
 */
function initVBO(data) {
    // get the VBO handle
    let VBOloc = gl.createBuffer();
    if (!VBOloc) {
        console.error('Failed to create the vertex buffer object');
        return false;
    }

    // Bind the VBO to the GPU array and copy `data` into that VBO
    gl.bindBuffer(gl.ARRAY_BUFFER, VBOloc);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);

    return true;
}

/**
 * Specifies properties of the given attribute on the GPU
 * @param {Number} length : the length of the vector (e.g. 3 for a Vector3);
 * @param {String} name : the name of the attribute in GLSL
 * @param {Number} stride : the stride in bytes
 * @param {Number} offset : the offset in bytes
 * @return {Boolean} true if the attribute was setup successfully, and false otherwise
 */
function setupVec(length, name, stride, offset) {
    // Get the attribute by name
    let attributeID = gl.getAttribLocation(gl.program, `${name}`);
    if (attributeID < 0) {
        console.error(`Failed to get the storage location of ${name}`);
        return false;
    }

    // Set how the GPU fills the a_Position letiable with data from the GPU 
    gl.vertexAttribPointer(attributeID, length, gl.FLOAT, false, stride, offset);
    gl.enableVertexAttribArray(attributeID);

    return true;
}