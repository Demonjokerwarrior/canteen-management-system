const sparkCanvas = document.getElementById("sparkleCanvas");
const sparkCtx = sparkCanvas.getContext("2d");

function resizeSparkCanvas() {
  sparkCanvas.width = window.innerWidth;
  sparkCanvas.height = window.innerHeight;
}

resizeSparkCanvas();
window.addEventListener("resize", resizeSparkCanvas);

const sparkles = Array.from({ length: 70 }, () => ({
  x: Math.random() * window.innerWidth,
  y: Math.random() * window.innerHeight,
  r: Math.random() * 2.2 + 0.5,
  vy: Math.random() * 0.35 + 0.15,
  alpha: Math.random() * 0.55 + 0.25
}));

function renderSparkles() {
  sparkCtx.clearRect(0, 0, sparkCanvas.width, sparkCanvas.height);
  for (const s of sparkles) {
    sparkCtx.beginPath();
    sparkCtx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    sparkCtx.fillStyle = `rgba(255, 180, 80, ${s.alpha})`;
    sparkCtx.shadowColor = "rgba(255, 153, 51, 0.8)";
    sparkCtx.shadowBlur = 8;
    sparkCtx.fill();

    s.y -= s.vy;
    if (s.y < -10) {
      s.y = sparkCanvas.height + 10;
      s.x = Math.random() * sparkCanvas.width;
    }
  }
  requestAnimationFrame(renderSparkles);
}

renderSparkles();

const heroContainer = document.getElementById("threeHero");
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  45,
  heroContainer.clientWidth / heroContainer.clientHeight,
  0.1,
  100
);
camera.position.z = 8;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(heroContainer.clientWidth, heroContainer.clientHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
heroContainer.appendChild(renderer.domElement);

const pointLight = new THREE.PointLight(0xff9933, 2.4, 40);
pointLight.position.set(4, 4, 5);
scene.add(pointLight);

const fillLight = new THREE.PointLight(0x138808, 1.8, 45);
fillLight.position.set(-4, -2, 4);
scene.add(fillLight);

const chakraGroup = new THREE.Group();
scene.add(chakraGroup);

const ringGeometry = new THREE.TorusGeometry(2.2, 0.1, 16, 100);
const ringMaterial = new THREE.MeshStandardMaterial({
  color: 0x000080,
  metalness: 0.6,
  roughness: 0.3
});
const ring = new THREE.Mesh(ringGeometry, ringMaterial);
chakraGroup.add(ring);

for (let i = 0; i < 24; i += 1) {
  const spokeGeo = new THREE.BoxGeometry(0.04, 1.85, 0.04);
  const spokeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.5 });
  const spoke = new THREE.Mesh(spokeGeo, spokeMat);
  spoke.rotation.z = (i / 24) * Math.PI * 2;
  chakraGroup.add(spoke);
}

const core = new THREE.Mesh(
  new THREE.SphereGeometry(0.24, 24, 24),
  new THREE.MeshStandardMaterial({ color: 0xd4af37, emissive: 0x402500, emissiveIntensity: 0.45 })
);
chakraGroup.add(core);

const halo = new THREE.Mesh(
  new THREE.TorusGeometry(2.8, 0.03, 8, 140),
  new THREE.MeshBasicMaterial({ color: 0xff9933, transparent: true, opacity: 0.4 })
);
chakraGroup.add(halo);

function animateThree() {
  chakraGroup.rotation.z += 0.005;
  chakraGroup.rotation.x = Math.sin(Date.now() * 0.0004) * 0.2;
  halo.rotation.z -= 0.002;
  renderer.render(scene, camera);
  requestAnimationFrame(animateThree);
}

animateThree();

window.addEventListener("resize", () => {
  camera.aspect = heroContainer.clientWidth / heroContainer.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(heroContainer.clientWidth, heroContainer.clientHeight);
});

document.addEventListener("scroll", () => {
  const y = window.scrollY;
  const rings = document.querySelectorAll(".hero-ring");
  rings.forEach((ring, index) => {
    const speed = (index + 1) * 0.05;
    ring.style.transform = `translateY(${y * speed}px) rotate(${y * 0.03}deg)`;
  });
});

const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
      }
    });
  },
  { threshold: 0.12 }
);

document.querySelectorAll(".reveal").forEach((el) => revealObserver.observe(el));

document.querySelectorAll(".tilt-card").forEach((card) => {
  card.addEventListener("mousemove", (event) => {
    const rect = card.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const midX = rect.width / 2;
    const midY = rect.height / 2;
    const rotateX = ((y - midY) / midY) * -5;
    const rotateY = ((x - midX) / midX) * 5;
    card.style.transform = `perspective(900px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-3px)`;
  });

  card.addEventListener("mouseleave", () => {
    card.style.transform = "perspective(900px) rotateX(0deg) rotateY(0deg) translateY(0)";
  });
});

const contactForm = document.querySelector(".contact-form");
contactForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const button = contactForm.querySelector("button");
  const oldLabel = button.textContent;
  button.textContent = "Message Sent";
  button.style.background = "linear-gradient(120deg, #138808, #22b455)";
  setTimeout(() => {
    button.textContent = oldLabel;
    button.style.background = "";
    contactForm.reset();
  }, 1400);
});
