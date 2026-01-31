import React, { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { LibreDwg, Dwg_File_Type } from '@mlightcad/libredwg-web';
import './FloorplanConverter.css';

// Helper: Point in Polygon (Ray Casting algorithm)
const isPointInPolygon = (point, vs) => {
    let x = point.x, y = point.y;
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        let xi = vs[i][0], yi = vs[i][1];
        let xj = vs[j][0], yj = vs[j][1];
        
        let intersect = ((yi > y) !== (yj > y))
            && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
};

// Helper: Get points from RotatedRect
    // Removed unused helper
  
    const FloorplanConverter = () => {
  // State
  const [imageSrc, setImageSrc] = useState(null);
  const [cvReady, setCvReady] = useState(false);
  const [status, setStatus] = useState('等待加载核心组件...');
    const [errorLog, setErrorLog] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    
    // Contour Data (The "Wall Info")
    const [contoursData, setContoursData] = useState([]); // Array of { id, points: [[x,y]...], area, isWall: bool }
    const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
    
    // Settings
    const [floorHeight, setFloorHeight] = useState(2.8);
    const [floorCount, setFloorCount] = useState(1);
    const [lineThreshold, setLineThreshold] = useState(50); // Hough Threshold
    const [minLineLength, setMinLineLength] = useState(20); // Min Line Length
    
    // Output
    const [glbUrl, setGlbUrl] = useState(null);
  
    // Refs
    const canvasRef = useRef(null); // Interactive Debug Canvas
    const mountRef = useRef(null); // Three.js Container
    const sceneRef = useRef(null);
    const rendererRef = useRef(null);
    const cameraRef = useRef(null);
    const controlsRef = useRef(null);
    
    // OpenCV Check
    useEffect(() => {
      const checkCv = setInterval(() => {
        if (window.cv && window.cv.Mat) {
          setCvReady(true);
          setStatus('核心组件就绪。请上传户型图或 DWG 文件。');
          clearInterval(checkCv);
        }
      }, 500);
      return () => clearInterval(checkCv);
    }, []);

  // Three.js Setup
  useEffect(() => {
    if (!mountRef.current) return;

    const width = mountRef.current.clientWidth;
    const height = mountRef.current.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1a); // Dark background for better 3D view
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(0, 50, 50);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controlsRef.current = controls;

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(50, 80, 50);
    dirLight.castShadow = true;
    scene.add(dirLight);
    const gridHelper = new THREE.GridHelper(100, 20);
    scene.add(gridHelper);

    // Axes Helper
    const axesHelper = new THREE.AxesHelper(5);
    scene.add(axesHelper);

    const animate = () => {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!mountRef.current) return;
      const w = mountRef.current.clientWidth;
      const h = mountRef.current.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (mountRef.current && renderer.domElement) {
        mountRef.current.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);

  // 1. File Upload Handler (Image or DWG)
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const fileName = file.name.toLowerCase();
    
    if (fileName.endsWith('.dwg') || fileName.endsWith('.dxf')) {
        // Handle DWG
        setStatus('检测到 DWG 文件。正在加载解析器...');
        setIsProcessing(true);
        setErrorLog('');
        
        try {
            const arrayBuffer = await file.arrayBuffer();
            await parseDwg(arrayBuffer);
        } catch (err) {
            console.error(err);
            setErrorLog('解析 DWG 失败: ' + err.message);
            setIsProcessing(false);
        }
    } else {
        // Handle Image
        const reader = new FileReader();
        reader.onload = (event) => {
            setImageSrc(event.target.result);
            setStatus('图片已加载。正在分析轮廓...');
            setTimeout(() => analyzeImage(event.target.result), 100);
        };
        reader.readAsDataURL(file);
    }
  };

  const parseDwg = async (arrayBuffer) => {
      try {
          setStatus('正在初始化 LibreDwg...');
          const libredwg = await LibreDwg.create({
              locateFile: (path) => {
                  console.log('LibreDwg requesting:', path);
                  if (path.endsWith('.wasm')) {
                      return '/libredwg-web.wasm';
                  }
                  return `/${path}`;
              }
          });
          
          setStatus('正在读取 DWG 数据...');
          const dwgData = libredwg.dwg_read_data(new Uint8Array(arrayBuffer), Dwg_File_Type.DWG);
          if (!dwgData) throw new Error("读取 DWG 数据失败");
          
          const db = libredwg.convert(dwgData);
          console.log("DWG DB:", db);

          let modelSpaceEntities = [];
          if (db.entities) {
              modelSpaceEntities = db.entities;
          } else if (db.blocks) {
              const ms = db.blocks.find(b => b.name === '*Model_Space' || b.name === '*MODEL_SPACE');
              if (ms && ms.entities) modelSpaceEntities = ms.entities;
          }

          if (modelSpaceEntities.length === 0) {
             throw new Error("在模型空间未找到实体");
          }

          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          const extractedShapes = [];

          modelSpaceEntities.forEach(ent => {
              let points = [];
              if (ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE') {
                   if (ent.points) points = ent.points.map(p => [p.x, p.y]);
                   else if (ent.vertices) points = ent.vertices.map(v => [v.x, v.y]);
              } else if (ent.type === 'LINE') {
                   points = [[ent.start.x, ent.start.y], [ent.end.x, ent.end.y]];
              }

              if (points.length > 0) {
                  points.forEach(p => {
                      if (p[0] < minX) minX = p[0];
                      if (p[0] > maxX) maxX = p[0];
                      if (p[1] < minY) minY = p[1];
                      if (p[1] > maxY) maxY = p[1];
                  });
                  extractedShapes.push({ points });
              }
          });

          const width = maxX - minX;
          const height = maxY - minY;
          const padding = Math.max(width, height) * 0.1;
          
          const normalizedContours = extractedShapes.map((shape, idx) => {
              const pts = shape.points.map(p => [p[0] - minX + padding, p[1] - minY + padding]);
              const first = pts[0];
              const last = pts[pts.length - 1];
              const isClosed = Math.abs(first[0] - last[0]) < 0.001 && Math.abs(first[1] - last[1]) < 0.001;
              
              let area = 0;
              if (isClosed) {
                  for (let i = 0; i < pts.length; i++) {
                      const j = (i + 1) % pts.length;
                      area += pts[i][0] * pts[j][1];
                      area -= pts[j][0] * pts[i][1];
                  }
                  area = Math.abs(area / 2);
              }

              return {
                  id: idx,
                  points: pts,
                  area: area, 
                  isWall: isClosed && area > 1, 
                  type: isClosed ? 'polygon' : 'line'
              };
          });

          setImageDimensions({ width: width + padding * 2, height: height + padding * 2 });
          setContoursData(normalizedContours);
          setImageSrc(null);
          setStatus(`DWG 解析完成。发现 ${normalizedContours.length} 个图形。`);
          setIsProcessing(false);
          libredwg.dwg_free(db);

      } catch (err) {
          console.error(err);
          setErrorLog("DWG 解析错误: " + err.message);
          setIsProcessing(false);
      }
  };

  const loadExample = () => {
      const src = '/example1.png';
      setImageSrc(src);
      setStatus('示例已加载。正在分析...');
      setTimeout(() => analyzeImage(src), 100);
  };

  const loadExampleDwg = async () => {
      setStatus('正在加载示例 DWG...');
      setIsProcessing(true);
      setErrorLog('');
      try {
          const response = await fetch('/example_cad.dwg');
          if (!response.ok) throw new Error('获取示例 DWG 失败');
          const arrayBuffer = await response.arrayBuffer();
          await parseDwg(arrayBuffer);
      } catch (err) {
          console.error(err);
          setErrorLog('示例加载失败: ' + err.message);
          setIsProcessing(false);
      }
  };

  // 2. Hough Line Transform Analysis
    const analyzeImage = (srcUrl) => {
        if (!cvReady) return;
        setIsProcessing(true);
        setErrorLog('');

        const imgElement = new Image();
        imgElement.src = srcUrl;
        imgElement.crossOrigin = 'Anonymous';
        
        imgElement.onload = () => {
          try {
            const cv = window.cv;
            const canvas = document.createElement('canvas');
            canvas.width = imgElement.width;
            canvas.height = imgElement.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(imgElement, 0, 0);
            
            setImageDimensions({ width: imgElement.width, height: imgElement.height });

            const src = cv.imread(canvas);
            const gray = new cv.Mat();
            cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
            
            // Canny Edge Detection
            const edges = new cv.Mat();
            cv.Canny(gray, edges, 50, 150, 3);
            
            // Hough Lines P
            const lines = new cv.Mat();
            // threshold, minLineLength, maxLineGap
            cv.HoughLinesP(edges, lines, 1, Math.PI / 180, lineThreshold, minLineLength, 10);

            const extractedContours = [];
            
            for (let i = 0; i < lines.rows; ++i) {
                let startPoint = new cv.Point(lines.data32S[i * 4], lines.data32S[i * 4 + 1]);
                let endPoint = new cv.Point(lines.data32S[i * 4 + 2], lines.data32S[i * 4 + 3]);
                
                extractedContours.push({
                    id: i,
                    points: [[startPoint.x, startPoint.y], [endPoint.x, endPoint.y]],
                    area: 0,
                    isWall: true, 
                    type: 'line'
                });
            }

            setContoursData(extractedContours);
            setStatus(`检测到 ${extractedContours.length} 条线段。`);
            
            src.delete();
            gray.delete();
            edges.delete();
            lines.delete();
            setIsProcessing(false);

          } catch (err) {
            console.error(err);
            setErrorLog('分析失败: ' + err.message);
            setIsProcessing(false);
          }
        };
    };

    // Re-run analysis when params change
    useEffect(() => {
        if (imageSrc && !imageSrc.endsWith('.dwg') && !imageSrc.endsWith('.dxf')) {
            analyzeImage(imageSrc);
        }
    }, [lineThreshold, minLineLength]);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas || !imageDimensions.width) return;
  
      const ctx = canvas.getContext('2d');
      canvas.width = imageDimensions.width;
      canvas.height = imageDimensions.height;
      
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      if (imageSrc) {
          const img = new Image();
          img.src = imageSrc;
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      } else {
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
  
      contoursData.forEach(c => {
        const pointsToUse = c.points;

        ctx.beginPath();
        if (pointsToUse.length > 0) {
            ctx.moveTo(pointsToUse[0][0], pointsToUse[0][1]);
            for (let i = 1; i < pointsToUse.length; i++) {
                ctx.lineTo(pointsToUse[i][0], pointsToUse[i][1]);
            }
            if (c.type === 'polygon') ctx.closePath();
        }

        if (c.isWall) {
            ctx.fillStyle = 'rgba(0, 255, 0, 0.5)'; 
            ctx.strokeStyle = 'green';
            ctx.lineWidth = 2;
        } else {
            ctx.fillStyle = 'rgba(255, 0, 0, 0.1)'; 
            ctx.strokeStyle = '#ccc';
            ctx.lineWidth = 1;
        }
        
        if (c.type === 'polygon') ctx.fill();
        ctx.stroke();
    });

  }, [contoursData, imageDimensions]);

  const handleCanvasClick = (e) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;

      const clickedContourIndex = contoursData.findIndex(c => {
          const pointsToUse = c.points;
          if (c.type === 'polygon') return isPointInPolygon({x, y}, pointsToUse);
          if (c.type === 'line') {
              const p1 = pointsToUse[0];
              const p2 = pointsToUse[1];
              const A = x - p1[0];
              const B = y - p1[1];
              const C = p2[0] - p1[0];
              const D = p2[1] - p1[1];
              
              const dot = A * C + B * D;
              const len_sq = C * C + D * D;
              let param = -1;
              if (len_sq !== 0) param = dot / len_sq;
              
              let xx, yy;
              
              if (param < 0) {
                  xx = p1[0]; yy = p1[1];
              } else if (param > 1) {
                  xx = p2[0]; yy = p2[1];
              } else {
                  xx = p1[0] + param * C;
                  yy = p1[1] + param * D;
              }
              
              const dx = x - xx;
              const dy = y - yy;
              const dist = Math.sqrt(dx * dx + dy * dy);
              
              return dist < 10; 
          }
          return false;
      });
      
      if (clickedContourIndex !== -1) {
          const newData = [...contoursData];
          newData[clickedContourIndex].isWall = !newData[clickedContourIndex].isWall;
          setContoursData(newData);
      }
  };

  const generate3D = () => {
    if (!sceneRef.current) return;
    setIsProcessing(true);
    setStatus('正在生成 3D 模型...');

    // 1. Clean up existing models
    const meshesToRemove = [];
    sceneRef.current.traverse((child) => {
        if (child.name === 'generated_model_wrapper' || child.name === 'generated_model') {
            meshesToRemove.push(child);
        }
    });
    meshesToRemove.forEach(mesh => sceneRef.current.remove(mesh));

    // 2. Build the model group (Mesh creation)
    const tempGroup = new THREE.Group();
    tempGroup.name = 'generated_model';
    
    const wallMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x808080,
        side: THREE.DoubleSide,
        roughness: 0.5,
        metalness: 0.1
    });
    const floorMaterial = new THREE.MeshStandardMaterial({ color: 0xeeeeee, side: THREE.DoubleSide });

    // Calculate Bounding Box of ACTUAL CONTENT (Walls)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let hasWalls = false;

    contoursData.forEach(c => {
        if (!c.isWall) return;
        hasWalls = true;
        c.points.forEach(p => {
            if (p[0] < minX) minX = p[0];
            if (p[0] > maxX) maxX = p[0];
            if (p[1] < minY) minY = p[1];
            if (p[1] > maxY) maxY = p[1];
        });
    });

    if (!hasWalls) {
        setStatus('未检测到有效墙体数据。');
        setIsProcessing(false);
        return;
    }

    const scale = 0.05; 
    // Center based on CONTENT, not Image Size
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;

    const offsetX = -centerX * scale;
    const offsetZ = -centerY * scale;

    let totalWalls = 0;

    for (let f = 0; f < floorCount; f++) {
        const floorY = f * floorHeight;

        contoursData.forEach(c => {
            if (!c.isWall) return;

            if (c.type === 'polygon') {
                const pointsToUse = c.points;
                const shape = new THREE.Shape();
                shape.moveTo(pointsToUse[0][0] * scale + offsetX, pointsToUse[0][1] * scale + offsetZ);
                for (let i = 1; i < pointsToUse.length; i++) {
                    shape.lineTo(pointsToUse[i][0] * scale + offsetX, pointsToUse[i][1] * scale + offsetZ);
                }
                shape.closePath();

                const extrudeSettings = {
                    steps: 1,
                    depth: floorHeight, 
                    bevelEnabled: false,
                };

                const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
                const mesh = new THREE.Mesh(geometry, wallMaterial);
                
                mesh.rotation.x = -Math.PI / 2; 
                mesh.position.y = floorY; 
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                tempGroup.add(mesh);
                totalWalls++;
            } else if (c.type === 'line') {
                const p1 = new THREE.Vector2(c.points[0][0] * scale + offsetX, c.points[0][1] * scale + offsetZ);
                const p2 = new THREE.Vector2(c.points[1][0] * scale + offsetX, c.points[1][1] * scale + offsetZ);
                
                const len = p1.distanceTo(p2);
                if (len < 0.01) return;

                const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
                const thickness = 0.2; // Fixed thickness for walls in meters

                const shape = new THREE.Shape();
                shape.moveTo(0, -thickness/2);
                shape.lineTo(len, -thickness/2);
                shape.lineTo(len, thickness/2);
                shape.lineTo(0, thickness/2);
                shape.closePath();

                const extrudeSettings = { steps: 1, depth: floorHeight, bevelEnabled: false };
                const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
                const mesh = new THREE.Mesh(geometry, wallMaterial);
                
                mesh.rotation.x = -Math.PI / 2;
                mesh.rotation.z = angle;
                mesh.position.set(p1.x, floorY, p1.y);
                
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                tempGroup.add(mesh);
                totalWalls++;
            }
        });

        // Floor based on content size + padding
        const floorPadding = 5; // Extra space around
        const floorGeo = new THREE.PlaneGeometry(
            contentWidth * scale + floorPadding * 2, 
            contentHeight * scale + floorPadding * 2
        );
        const floorMesh = new THREE.Mesh(floorGeo, floorMaterial);
        floorMesh.rotation.x = -Math.PI / 2;
        floorMesh.position.y = floorY;
        // Floor is already centered at 0,0 because geometry is centered and we don't offset it (content is centered at 0,0)
        floorMesh.receiveShadow = true;
        tempGroup.add(floorMesh);
    }

    if (totalWalls === 0) {
        setStatus('未检测到墙体。请确保选择了绿色线段。');
        setIsProcessing(false);
        return;
    }

    // 3. Render IMMEDIATELY
    const wrapper = new THREE.Group();
    wrapper.name = 'generated_model_wrapper';
    
    // Model is already centered by vertex manipulation, no need to shift group
    wrapper.add(tempGroup);
    sceneRef.current.add(wrapper);
    
    // Force Matrix Update
    tempGroup.updateMatrixWorld(true);
    
    // 4. Update Camera View
    resetView();

    setStatus(`渲染完成！正在后台生成 GLB 下载链接...`);

    // 5. Async Export GLB
    setTimeout(() => {
        const exporter = new GLTFExporter();
        exporter.parse(tempGroup, (result) => {
            if (result instanceof ArrayBuffer) {
                const blob = new Blob([result], { type: 'application/octet-stream' });
                const url = URL.createObjectURL(blob);
                setGlbUrl(url);
                setStatus('模型已生成！可点击下载。');
                setIsProcessing(false);
            }
        }, { binary: true });
    }, 100);
  };

  const resetView = () => {
    if (!sceneRef.current || !cameraRef.current || !controlsRef.current) return;
    const wrapper = sceneRef.current.getObjectByName('generated_model_wrapper');
    if (wrapper) {
      const box = new THREE.Box3().setFromObject(wrapper);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      
      if (maxDim > 0 && maxDim < Infinity) {
        const fov = cameraRef.current.fov * (Math.PI / 180);
        // Calculate optimal distance to fit object in view
        // Add 20% padding (multiply by 1.2)
        const cameraDist = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.5;
        
        // Ensure not too close, not too far, but relative to size
        const dist = Math.max(cameraDist, 5); 

        // Position camera at an angle
        const offset = dist / Math.sqrt(3); // distribute distance to x, y, z
        
        cameraRef.current.position.set(center.x + offset, center.y + offset, center.z + offset);
        cameraRef.current.lookAt(center);
        
        controlsRef.current.target.copy(center);
        controlsRef.current.update();
        return;
      }
    }
    // Default fallback
    cameraRef.current.position.set(50, 50, 50);
    cameraRef.current.lookAt(0, 0, 0);
    controlsRef.current.target.set(0, 0, 0);
    controlsRef.current.update();
  };

  return (
    <div className="fpc-container">
        {/* Left Sidebar: Edit Box */}
        <div className="fpc-sidebar">
            <div className="fpc-sidebar-content">
                <div className="fpc-section">
                    <h3 className="fpc-section-title">1. 输入文件</h3>
                     <div className="fpc-row">
                        <label className="fpc-btn-upload">
                            上传文件 (图片/DWG)
                            <input type="file" accept="image/*,.dwg,.dxf" onChange={handleFileUpload} disabled={isProcessing} hidden />
                        </label>
                    </div>
                    <div className="fpc-row">
                        <button onClick={loadExample} disabled={isProcessing} className="fpc-btn-small">加载示例图片</button>
                        <button onClick={loadExampleDwg} disabled={isProcessing} className="fpc-btn-small">加载示例 DWG</button>
                    </div>
                </div>

                <div className="fpc-section">
                    <h3 className="fpc-section-title">2. 建筑参数</h3>
                    <div className="fpc-row">
                        <div className="fpc-field">
                            <label>层高 (m)</label>
                            <input type="number" step="0.1" value={floorHeight} onChange={e => setFloorHeight(parseFloat(e.target.value))} />
                        </div>
                        <div className="fpc-field">
                            <label>层数</label>
                            <input type="number" min="1" max="20" value={floorCount} onChange={e => setFloorCount(parseInt(e.target.value))} />
                        </div>
                    </div>
                </div>

                <div className="fpc-section">
                    <h3 className="fpc-section-title">3. 识别设置</h3>
                     <div className="fpc-field">
                        <label>线条阈值 (Hough): {lineThreshold}</label>
                        <input type="range" min="10" max="200" value={lineThreshold} onChange={e => setLineThreshold(Number(e.target.value))} />
                    </div>
                    <div className="fpc-field">
                        <label>最小线长: {minLineLength}</label>
                        <input type="range" min="5" max="100" value={minLineLength} onChange={e => setMinLineLength(Number(e.target.value))} />
                    </div>
                </div>

                <div className="fpc-section" style={{flex: 1, display: 'flex', flexDirection: 'column', minHeight: '200px'}}>
                    <h3 className="fpc-section-title">4. 线条预览 (点击绿色切换墙体)</h3>
                    <div className="fpc-canvas-wrapper">
                        <canvas ref={canvasRef} onClick={handleCanvasClick} />
                    </div>
                </div>

                <div className="fpc-section">
                     <div className="fpc-status-text">{status}</div>
                     {errorLog && <div className="fpc-error-text">{errorLog}</div>}
                     
                    <button 
                        onClick={generate3D} 
                        disabled={isProcessing || contoursData.length === 0}
                        className="fpc-btn-primary"
                    >
                        {isProcessing ? '处理中...' : '生成 3D 模型'}
                    </button>
                     
                     <div className="fpc-row" style={{marginTop: '10px'}}>
                        <button onClick={resetView} className="fpc-btn-secondary">重置视角</button>
                        {glbUrl && (
                            <a href={glbUrl} download="building.glb" className="fpc-link-btn">
                                下载 GLB
                            </a>
                        )}
                    </div>
                </div>
            </div>
        </div>

        {/* Right Panel: 3D View */}
        <div ref={mountRef} className="fpc-3d-view"></div>
    </div>
  );
};

export default FloorplanConverter;