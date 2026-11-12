package za.co.proteabank.authenticator

import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage

/** The camera, looking for a QR code. ML Kit's bundled model reads it, so no Google services are needed. `onFound` gets each code's text. */
@Composable
fun QrScanner(owner: LifecycleOwner, modifier: Modifier = Modifier, onFound: (String) -> Unit) {
	AndroidView(modifier = modifier, factory = { context ->
		PreviewView(context).also { view ->
			val future = ProcessCameraProvider.getInstance(context)
			future.addListener({
				val scanner = BarcodeScanning.getClient(BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build())
				val preview = Preview.Builder().build().also { it.surfaceProvider = view.surfaceProvider }
				val analysis = ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build()
				analysis.setAnalyzer(ContextCompat.getMainExecutor(context)) { proxy ->
					val image = proxy.image
					if (image == null) { proxy.close(); return@setAnalyzer }
					scanner.process(InputImage.fromMediaImage(image, proxy.imageInfo.rotationDegrees))
						.addOnSuccessListener { codes -> codes.firstNotNullOfOrNull { it.rawValue }?.let(onFound) }
						.addOnCompleteListener { proxy.close() }
				}
				val provider = future.get()
				provider.unbindAll()
				provider.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
			}, ContextCompat.getMainExecutor(context))
		}
	})
}
