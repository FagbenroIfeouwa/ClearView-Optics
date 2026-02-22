import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as vision from "@mediapipe/tasks-vision";

const { FaceLandmarker, FilesetResolver, DrawingUtils } = vision;
const demosSection = document.getElementById("demos");
const videoBlendShapes = document.getElementById("video-blend-shapes") || null;

let faceLandmarker;
let runningMode = "IMAGE";
let enableWebcamButton;
let webcamRunning = false;

async function createFaceLandmarker() {
  const filesetResolver = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
  );
  faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
    baseOptions: {
      modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
      delegate: "GPU"
    },
    outputFaceBlendshapes: true,
    runningMode: "IMAGE",
    numFaces: 1
  });
  demosSection.classList.remove("invisible");
}
createFaceLandmarker();

function exerciseFive() {
  const scene = new THREE.Scene();
  const canvas = document.getElementById("three_canvas");
  const canvasElement = document.getElementById("output_canvas");
  const video = document.getElementById("webcam");

  const modal = document.getElementById("tryOnModal");
  const closeBtn = document.getElementById("closeModal");

  // Create renderer with transparent background
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    canvas: canvas,
    alpha: true
  });
  renderer.setClearColor(0x000000, 0);

  // Orthographic camera — will be properly set once video loads
  let camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.position.z = 1;

  const canvasCtx = canvasElement.getContext("2d");

  const gltfLoader = new GLTFLoader();
  let model;

  // Fallback test glasses (visible while GLTF loads)
  const lensGeometry = new THREE.TorusGeometry(0.08, 0.01, 16, 32);
  const lensMaterial = new THREE.MeshBasicMaterial({ color: 0x0000ff });

  const testGlasses = new THREE.Group();
  const bridgeGeometry = new THREE.CylinderGeometry(0.01, 0.01, 0.24, 8);
  const bridgeMesh = new THREE.Mesh(bridgeGeometry, lensMaterial);
  bridgeMesh.rotation.z = Math.PI / 2;
  testGlasses.add(bridgeMesh);
  scene.add(testGlasses);
  model = testGlasses;

  // Load real glasses GLTF model
  gltfLoader.load(
    "./Glass/scene.gltf",
    (gltf) => {
      // Remove fallback
      scene.remove(testGlasses);

      const loadedModel = gltf.scene;

      // Center the model at origin
      const box = new THREE.Box3().setFromObject(loadedModel);
      const center = box.getCenter(new THREE.Vector3());
      loadedModel.position.sub(center);

      const modelGroup = new THREE.Group();
      modelGroup.add(loadedModel);
      scene.add(modelGroup);
      model = modelGroup;

      model.traverse((child) => {
        if (child.isMesh) {
          child.visible = true;
        }
      });

      console.log("✅ Glasses model loaded!");
    },
    (progress) => {
      console.log("Loading:", (progress.loaded / progress.total) * 100 + "%");
    },
    (error) => {
      console.error("❌ Error loading model:", error);
    }
  );

  // Lighting
  scene.add(new THREE.AmbientLight(0xffffff, 3));
  const light1 = new THREE.DirectionalLight(0xffffff, 2);
  light1.position.set(0, 0, 5);
  scene.add(light1);
  const light2 = new THREE.DirectionalLight(0xffffff, 2);
  light2.position.set(0, 0, -5);
  scene.add(light2);

  // Webcam support check
  function hasGetUserMedia() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  if (hasGetUserMedia()) {
    enableWebcamButton = document.getElementById("webcamButton");

    closeBtn.addEventListener("click", () => {
      modal.classList.remove("active");
      document.body.style.overflow = "auto";
      webcamRunning = false;

      // Stop webcam stream
      if (video.srcObject) {
        video.srcObject.getTracks().forEach((track) => track.stop());
        video.srcObject = null;
      }
    });

    enableWebcamButton.addEventListener("click", enableCam);
  } else {
    console.warn("getUserMedia() is not supported by your browser");
  }

  let cameraInitialized = false;
  let lastVideoTime = -1;
  let results = undefined;
  const drawingUtils = new DrawingUtils(canvasCtx);

  function enableCam() {
    if (!faceLandmarker) {
      console.log("Wait! faceLandmarker not loaded yet.");
      return;
    }

    modal.classList.add("active");
    document.body.style.overflow = "hidden";
    webcamRunning = true;

    const constraints = { video: { width: 1280, height: 720 } };

    navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
      video.srcObject = stream;

      video.addEventListener("loadeddata", () => {
        const modalBox = document.querySelector(".modal-box");
        const containerWidth = modalBox.clientWidth;
        const containerHeight = modalBox.clientHeight;

        // Set canvas internal resolution to match video
        canvasElement.width = video.videoWidth;
        canvasElement.height = video.videoHeight;
        canvasElement.style.width = containerWidth + "px";
        canvasElement.style.height = containerHeight + "px";

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.style.width = containerWidth + "px";
        canvas.style.height = containerHeight + "px";

        renderer.setSize(video.videoWidth, video.videoHeight, false);

        const aspect = video.videoWidth / video.videoHeight;
        camera = new THREE.OrthographicCamera(-aspect, aspect, 1, -1, 0.1, 100);
        camera.position.z = 1;
        camera.lookAt(0, 0, 0);

        cameraInitialized = true;
        console.log("✅ Camera initialized. Aspect:", aspect);
      });
    });
  }

  // ✅ Single unified loop — handles face detection + Three.js rendering
  async function animate() {
    requestAnimationFrame(animate);

    // Only run detection + render when webcam is active and ready
    if (!cameraInitialized || !webcamRunning) {
      return;
    }

    // Switch to VIDEO mode if needed
    if (runningMode === "IMAGE") {
      runningMode = "VIDEO";
      await faceLandmarker.setOptions({ runningMode: "VIDEO" });
    }

    // Run face landmark detection on new frames only
    const startTimeMs = performance.now();
    if (lastVideoTime !== video.currentTime) {
      lastVideoTime = video.currentTime;
      results = faceLandmarker.detectForVideo(video, startTimeMs);
    }

    // Clear the 2D canvas overlay
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    // Position the glasses model using face landmarks
    if (results && results.faceLandmarks && results.faceLandmarks.length > 0) {
      const landmarks = results.faceLandmarks[0];

      if (model && landmarks.length > 454) {
        const leftEyeOuter = landmarks[33];
        const rightEyeOuter = landmarks[263];
        const noseBridge = landmarks[168];

        // ✅ Use midpoint BETWEEN the two eyes as anchor (not nose bridge)
        const eyeCenterX = (leftEyeOuter.x + rightEyeOuter.x) / 2;
        const eyeCenterY = (leftEyeOuter.y + rightEyeOuter.y) / 2;
        const eyeCenterZ = (leftEyeOuter.z + rightEyeOuter.z) / 2;

        const aspect = video.videoWidth / video.videoHeight;

        // Tuning controls
        const SCALE_MULTIPLIER = 2.2;
        const VERTICAL_OFFSET = -0.05;
        const HORIZONTAL_OFFSET = 0;
        const DEPTH_OFFSET = 0.3;

        // Convert MediaPipe coords (0–1) to Three.js coords (-aspect to +aspect, -1 to +1)
        // ✅ Flipped X axis
        const modelpositionx =
          (eyeCenterX - 0.5) * 2 * aspect + HORIZONTAL_OFFSET;
        const modelpositiony = (0.5 - eyeCenterY) * 2 + VERTICAL_OFFSET;
        const modelpositionz = eyeCenterZ * -1 + DEPTH_OFFSET;

        model.position.set(modelpositionx, modelpositiony, modelpositionz);

        // Scale based on eye distance
        const eyeDistance = Math.abs(rightEyeOuter.x - leftEyeOuter.x);
        const scale = eyeDistance * aspect * SCALE_MULTIPLIER;
        model.scale.set(scale, scale, scale);

        // Rotate to match face tilt
        const angle = Math.atan2(
          rightEyeOuter.y - leftEyeOuter.y,
          rightEyeOuter.x - leftEyeOuter.x
        );
        model.rotation.z = angle;
      }
    }

    canvasCtx.restore();

    // Render Three.js scene
    renderer.render(scene, camera);
  }

  animate();
  console.log("🚀 exerciseFive initialized");
}

exerciseFive();

// const open_modal = document.getElementById("open-modal");
// const close_modal = document.getElementById("close-modal");
// const modal_overlay = document.querySelector(".modal-overlay");
// const modal = document.querySelector(".modal");

// console.log("Modal elements:", {
//   open_modal,
//   close_modal,
//   modal_overlay,
//   modal
// });

// open_modal.addEventListener("click", () => {
//   modal_overlay.classList.add("active");
// });

// close_modal.addEventListener("click", () => {
//   modal_overlay.classList.remove("active");
// });

// modal_overlay.addEventListener("click", (event) => {
//   if (event.target === modal_overlay) {
//     modal_overlay.classList.remove("active");
//   }
// });
