import * as THREE from 'three/webgpu';
import { clamp, mix, pow, vec4, mrt, normalView, output, pass, float } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';

/**
 * Screen-space ambient occlusion (GTAO) for the High tier. One scene pass writes colour, normals and depth, the
 * AO is computed from those and multiplies the colour: contact shadows under trees, huts, bridges and feet.
 * Off, it is a plain renderer.render(). Only built on the WebGPU backend; the WebGL2 fallback never uses it.
 */
export class PostFx {
  private pipeline: THREE.RenderPipeline | null = null;

  constructor(
    private renderer: THREE.WebGPURenderer,
    private scene: THREE.Scene,
    private camera: THREE.Camera,
    /** False on the WebGL2 fallback: set() then does nothing. */
    private supported: boolean,
  ) {}

  get active(): boolean {
    return this.pipeline !== null;
  }

  /** Turns the effect on or off. Safe to call every tier change. */
  set(on: boolean) {
    if (!this.supported) return;
    if (on === this.active) return;
    if (!on) {
      this.pipeline?.dispose();
      this.pipeline = null;
      return;
    }
    const scenePass = pass(this.scene, this.camera, { samples: 4 });
    scenePass.setMRT(mrt({ output, normal: normalView }));
    const colour = scenePass.getTextureNode('output');
    const normal = scenePass.getTextureNode('normal');
    const depth = scenePass.getTextureNode('depth');

    const aoPass = ao(depth, normal, this.camera);
    aoPass.resolutionScale = 0.5;
    aoPass.radius.value = 1.0;
    aoPass.thickness.value = 1.2;
    const occlusion = aoPass.getTextureNode().r;
    // Keep 25% of the light in the darkest corners, so the cartoon colours never go muddy. Squared for a stronger look.
    const factor = mix(float(0.25), float(1), pow(clamp(occlusion, 0, 1), float(2)));

    this.pipeline = new THREE.RenderPipeline(this.renderer);
    this.pipeline.outputNode = vec4(colour.rgb.mul(factor), colour.a);
  }

  /** Draws the frame: through the post pipeline when on, else directly. */
  render() {
    if (this.pipeline) this.pipeline.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /** Same as render(), but waits for pipelines to compile first. For the loading warm-up. */
  async renderAsync() {
    if (this.pipeline) await this.pipeline.renderAsync();
    else await this.renderer.renderAsync(this.scene, this.camera);
  }
}
