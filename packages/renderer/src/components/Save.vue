<template>
  <n-modal
    :show="showModal"
    :show-icon="false"
    :on-mask-click="cancel"
    :on-esc="cancel"
    :on-close="cancel"
    preset="dialog"
  >
    <template #header>
      下载参数配置
    </template>
    <div class="dialog-content">
      <n-descriptions
        label-placement="left"
        title="下载范围"
        size="small"
        :column="1"
        class="descriptions"
      >
        <n-descriptions-item label="xmin">
          {{ downloadExtent.xmin }}
        </n-descriptions-item>
        <n-descriptions-item label="xmax">
          {{ downloadExtent.xmax }}
        </n-descriptions-item>
        <n-descriptions-item label="ymin">
          {{ downloadExtent.ymin }}
        </n-descriptions-item>
        <n-descriptions-item label="ymax">
          {{ downloadExtent.ymax }}
        </n-descriptions-item>
      </n-descriptions>

      <!-- 一级选项：下载内容 -->
      <div class="item">
        <span class="label">下载内容：</span>
        <div class="value">
          <n-select
            v-model:value="downloadCategory"
            :options="categoryOptions"
            @update:value="handleCategoryChange"
          />
        </div>
      </div>

      <!-- 二级选项：当下载内容为天地图矢量切片时，显示矢量类型 -->
      <div
        v-if="isVectorDownload"
        class="item"
      >
        <span class="label">矢量类型：</span>
        <div class="value">
          <n-select
            v-model:value="vectorType"
            :options="vectorTypeOptions"
          />
        </div>
      </div>

      <!-- 选择1（天地图矢量）时：只留一个层级参数 -->
      <div
        v-if="isVectorDownload"
        class="item"
      >
        <span class="label">下载层级：</span>
        <input
          v-model="vectorZoom"
          class="value"
          type="text"
          placeholder="推荐 17 级（全量建筑与路网）"
        >
      </div>

      <!-- 选择2（栅格切片）时：保留最小层级与最大层级两个参数 -->
      <template v-else>
        <div class="item">
          <span class="label">最小层级：</span>
          <input
            v-model="minZoom"
            class="value"
            type="text"
          >
        </div>
        <div class="item">
          <span class="label">最大层级：</span>
          <input
            v-model="maxZoom"
            class="value"
            type="text"
          >
        </div>
      </template>

      <!-- 矢量下载说明提示 -->
      <div
        v-if="isVectorDownload"
        class="vector-tip-box"
      >
        <n-alert
          type="info"
          :show-icon="true"
        >
          <div><strong>天地图矢量单级提取 GeoJSON</strong></div>
          <div style="font-size: 12px; margin-top: 2px; line-height: 1.5;">
            矢量数据采用单级提取（默认推荐 17 级，包含全量建筑三维与路网），导出为 GeoJSON 后在 GIS 中可无级缩放，避免多层级造成要素重复。
          </div>
        </n-alert>
      </div>

      <!-- 栅格专属选项：合并标注 -->
      <div
        v-if="showMerge"
        class="item"
      >
        <span class="label">合并标注：</span>
        <div class="value">
          <input
            v-model="mergeLayers"
            type="checkbox"
          >是否合并
        </div>
        <div
          v-if="mergeLayers"
          class="warning-merge"
        >
          下载大量瓦片时，合并可能会造成卡死！
        </div>
      </div>

      <!-- 栅格专属选项：边界裁切 -->
      <div
        v-if="!isVectorDownload"
        class="item"
      >
        <span class="label">边界裁切：</span>
        <div class="value">
          <input
            v-model="clipImage"
            type="checkbox"
          >
        </div>
      </div>

      <div class="item">
        <span class="label">下载路径：</span>
        <div class="value">
          <input
            v-model="savePath"
            type="text"
            disabled
            style="width:215px;"
          >
          <button @click="setFolder">
            选择
          </button>
        </div>
      </div>

      <div class="item">
        <span class="label">瓦片格式：</span>
        <div class="value">
          <n-select
            v-model:value="imageType"
            :options="computedImageTypeList"
            :disabled="isVectorDownload"
          />
        </div>
      </div>
    </div>
    <template #action>
      <n-button @click="cancel">
        取消
      </n-button>
      <n-button
        type="info"
        @click="ok"
      >
        确定
      </n-button>
    </template>
  </n-modal>
</template>

<script>
import {defineComponent} from 'vue';
export default defineComponent({
  name: 'SaveDialog',
  props: {
    visible: {
      required: true,
      type: Boolean,
    },
    downloadExtent: {
      required: true,
      type: Object,
    },
    baseLayer: {
      required: true,
      type: [Object, Array],
    },
    limitMinZoom: {
      required: true,
      type: Number,
    },
    limitMaxZoom: {
      required: true,
      type: Number,
    },
    isBaidu: {
      required: true,
      type: Boolean,
    },
  },
  setup() {

  },
  data() {
    return {
      showModal: false,
      savePath: '',
      vectorZoom: '17', // 天地图矢量下载单级参数，默认17
      maxZoom: '8',
      minZoom: '5',
      downloadCategory: 'tdt_vector', // 一级选项：tdt_vector | current_raster
      categoryOptions: [
        {
          label: '1、天地图矢量切片',
          value: 'tdt_vector',
        },
        {
          label: '2、当前地图栅格切片',
          value: 'current_raster',
        },
      ],
      vectorType: 'all', // 二级选项：矢量的类型
      vectorTypeOptions: [
        {
          label: '全部要素 (底图要素 + 注记标注)',
          value: 'all',
        },
        {
          label: '基础底图要素 (建筑/水系/绿地/地块/路网)',
          value: 'base',
        },
        {
          label: '建筑物要素 (仅建筑轮廓面与层高白模)',
          value: 'building',
        },
        {
          label: '水系与绿地要素 (水系面BM + 绿地面CK)',
          value: 'water_green',
        },
        {
          label: '道路路网要素 (交通道路与中心线)',
          value: 'road',
        },
        {
          label: '文字注记要素 (POI点位、地名路名标注)',
          value: 'label',
        },
      ],
      mergeLayers: false,
      clipImage: false,
      imageType: 'geojson',
      imageTypeList: [
        {
          label: 'png',
          value: 'png',
        },
        {
          label: 'jpeg',
          value: 'jpeg',
        },
        {
          label: 'webp',
          value: 'webp',
        },
      ],
    };
  },
  computed: {
    isVectorDownload() {
      return this.downloadCategory === 'tdt_vector';
    },
    showMerge() {
      if (this.isVectorDownload) return false;
      return Array.isArray(this.baseLayer) && this.baseLayer.length > 1;
    },
    computedImageTypeList() {
      if (this.isVectorDownload) {
        return [
          {
            label: 'GeoJSON (*.geojson)',
            value: 'geojson',
          },
        ];
      }
      return this.imageTypeList;
    },
  },
  watch: {
    visible(val) {
      this.showModal = val;
      if (val) {
        if (this.checkCurrentIsVector()) {
          this.downloadCategory = 'tdt_vector';
        }
        this.applyCategoryState();
      }
    },
  },
  created() {
    this.showModal = this.visible;
    if (this.checkCurrentIsVector()) {
      this.downloadCategory = 'tdt_vector';
    }
    this.applyCategoryState();
  },
  mounted() {
  },
  methods: {
    checkCurrentIsVector() {
      if (Array.isArray(this.baseLayer)) {
        return this.baseLayer.some(l => l && (l.isVectorGeojson || (l.config && l.config().style && l.config().style.startsWith('Vector_'))));
      }
      if (this.baseLayer) {
        return !!(this.baseLayer.isVectorGeojson || (this.baseLayer.config && this.baseLayer.config().style && this.baseLayer.config().style.startsWith('Vector_')));
      }
      return false;
    },
    handleCategoryChange(val) {
      this.downloadCategory = val;
      this.applyCategoryState();
    },
    applyCategoryState() {
      if (this.isVectorDownload) {
        this.imageType = 'geojson';
        this.clipImage = false;
        this.mergeLayers = false;
        if (!this.vectorZoom) {
          this.vectorZoom = '17';
        }
      } else {
        if (this.imageType === 'geojson') {
          this.imageType = 'png';
        }
        if (!this.minZoom) this.minZoom = '5';
        if (!this.maxZoom) this.maxZoom = '8';
      }
    },
    reset() {
      this.savePath = '';
      this.vectorZoom = '17';
      this.maxZoom = '';
      this.minZoom = '';
    },
    async setFolder() {
      const result = await window.electron.ipcRenderer.invoke('show-dialog');
      if (result.canceled) return;
      this.savePath = result.filePaths[0];
    },
    cancel() {
      this.reset();
      // eslint-disable-next-line
      this.$emit('cancel', {});
    },
    ok() {
      if (!this.savePath) {
        return window.$message.warning('请选择保存目录');
      }

      let minZoom, maxZoom;
      if (this.isVectorDownload) {
        if (!this.vectorZoom) {
          return window.$message.warning('请输入下载层级');
        }
        const z = parseInt(Number(this.vectorZoom));
        if (isNaN(z) || z < 1 || z > 18) {
          return window.$message.warning('天地图矢量层级范围为 1~18 级（推荐 14~17 级）');
        }
        minZoom = z;
        maxZoom = z;
      } else {
        if (!this.maxZoom) {
          return window.$message.warning('请输入最大层级');
        }
        if (!this.minZoom) {
          return window.$message.warning('请输入最小层级');
        }
        minZoom = parseInt(Number(this.minZoom));
        maxZoom = parseInt(Number(this.maxZoom));
        if (isNaN(minZoom) || isNaN(maxZoom)) {
          return window.$message.warning('层级格式错误，请输入非负整数');
        }
        if (minZoom > maxZoom) {
          return window.$message.warning('最小层级不能大于最大层级');
        }
        if (minZoom < this.limitMinZoom || maxZoom > this.limitMaxZoom) {
          return window.$message.warning('层级格式错误');
        }
      }

      if (this.isBaidu && this.clipImage && !this.isVectorDownload) {
        return window.$message.warning('百度瓦片暂不支持裁切，请取消裁切后重试');
      }

      const param = {
        downloadCategory: this.downloadCategory,
        downloadTarget: this.isVectorDownload ? 'tdt_vector' : 'current_base',
        vectorType: this.vectorType,
        savePath: this.savePath,
        minZoom: minZoom,
        maxZoom: maxZoom,
        mergeLayers: this.mergeLayers,
        extent: this.downloadExtent,
        clipImage: this.clipImage,
        imageType: this.imageType,
      };
      // eslint-disable-next-line
      this.$emit('ok', param);
    },
  },
});
</script>

<style lang="scss" scoped>
.dialog-content{
  width: 100%;
  padding: 8px 16px;
  .item{
    margin: 4px 0;
  }
  .label{
    display: inline-block;
    width: 80px;
    text-align: right;
  }
  .value{
    display: inline-block;
    width: 260px;
  }
}
.vector-tip-box{
  margin: 6px 0 10px 0;
}
.descriptions{
  ::v-deep .n-descriptions-header{
    font-size: 14px;
    margin-bottom: 3px;
  }
  ::v-deep .n-descriptions-table-content__label{
    display: inline-block;
    width: 80px;
    text-align: right;
  }
}
.warning-merge{
  width: 100%;
  color: red;
  padding-left: 83px;
}
</style>
