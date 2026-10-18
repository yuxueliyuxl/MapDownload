import BaseTileLayer from './BaseTileLayer';
import params from './../param';
import { xyz2pk } from '../../tianditu_pk.js';

class TDTTileLayer extends BaseTileLayer {
  constructor(id, options = {}) {
    const style = options.style || 'Normal';
    const isVector = style.startsWith('Vector_');

    // 矢量图层在地图显示时使用普通栅格作为参考底图，防止 Maptalks 渲染报错或白屏
    if (isVector) {
      options.urlTemplate = params().TDT.Normal.url;
      options.vectorUrlTemplate = params().TDT[style].url;
      options.isVectorGeojson = true;
    } else {
      options.urlTemplate = params().TDT[style].url;
    }

    super(id, options);
    this.style = style;
    this.isVectorGeojson = isVector;
    this.vectorUrlTemplate = options.vectorUrlTemplate;
  }

  /**
   * 获取用于下载的真实瓦片 URL
   */
  getTileUrl(x, y, z) {
    let template = this.isVectorGeojson && this.vectorUrlTemplate
      ? this.vectorUrlTemplate
      : this.options.urlTemplate;

    if (template.includes('{pk}')) {
      template = template.replace('{pk}', xyz2pk(x, y, z));
    }
    return template
      .replace('{x}', x)
      .replace('{y}', y)
      .replace('{z}', z);
  }
}

export default TDTTileLayer;
