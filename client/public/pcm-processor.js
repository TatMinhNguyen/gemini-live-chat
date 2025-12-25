class PCMProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0]; // Float32Array

    const buffer = new ArrayBuffer(channelData.length * 2);
    const view = new DataView(buffer);

    let offset = 0;
    for (let i = 0; i < channelData.length; i++, offset += 2) {
      let sample = Math.max(-1, Math.min(1, channelData[i]));
      view.setInt16(
        offset,
        sample < 0 ? sample * 0x8000 : sample * 0x7fff,
        true // little-endian
      );
    }

    // 🚀 GỬI INT16 PCM
    this.port.postMessage(buffer, [buffer]);
    return true;
  }
}

registerProcessor("pcm-processor", PCMProcessor);
