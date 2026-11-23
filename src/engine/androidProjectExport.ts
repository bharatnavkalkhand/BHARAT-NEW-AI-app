export interface AndroidProjectFile {
  path: string;
  language: 'kotlin' | 'xml' | 'gradle';
  description: string;
  content: string;
}

export const ANDROID_PROJECT_FILES: AndroidProjectFile[] = [
  {
    path: 'app/build.gradle.kts',
    language: 'gradle',
    description: 'Android Compose + Media3 Transformer & ExoPlayer build configuration',
    content: `plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.bharatai.pocketengine"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.bharatai.pocketengine"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "2.0.0"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2025.05.00")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.9.0")

    val media3Version = "1.11.1"
    implementation("androidx.media3:media3-transformer:$media3Version")
    implementation("androidx.media3:media3-common:$media3Version")
    implementation("androidx.media3:media3-exoplayer:$media3Version")
    implementation("androidx.media3:media3-ui:$media3Version")

    val filamentVersion = "1.56.0"
    implementation("com.google.android.filament:filament-android:$filamentVersion")
    implementation("com.google.android.filament:filament-utils-android:$filamentVersion")
    implementation("com.google.android.filament:gltfio-android:$filamentVersion")
}
`,
  },
  {
    path: 'app/src/main/AndroidManifest.xml',
    language: 'xml',
    description: 'OpenGL ES 2.0 feature declaration, Audio permission, Speech/TTS queries, and FileProvider',
    content: `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-feature android:glEsVersion="0x00030000" android:required="true" />

    <queries>
        <intent><action android:name="android.speech.RecognitionService" /></intent>
        <intent><action android:name="android.speech.action.RECOGNIZE_SPEECH" /></intent>
        <intent><action android:name="android.intent.action.TTS_SERVICE" /></intent>
    </queries>

    <application
        android:allowBackup="true"
        android:label="Bharat-AI Pocket"
        android:supportsRtl="true"
        android:theme="@android:style/Theme.Material.NoActionBar">

        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:windowSoftInputMode="adjustResize">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

        <provider
            android:name="androidx.core.content.FileProvider"
            android:authorities="\${applicationId}.fileprovider"
            android:exported="false"
            android:grantUriPermissions="true">
            <meta-data
                android:name="android.support.FILE_PROVIDER_PATHS"
                android:resource="@xml/file_paths" />
        </provider>
    </application>
</manifest>
`,
  },
  {
    path: 'app/src/main/res/xml/file_paths.xml',
    language: 'xml',
    description: 'FileProvider paths for sharing exported MP4 movies',
    content: `<?xml version="1.0" encoding="utf-8"?>
<paths>
    <cache-path name="cache" path="." />
    <files-path name="files" path="." />
</paths>
`,
  },
  {
    path: 'app/src/main/java/com/bharatai/pocketengine/model/StudioModels.kt',
    language: 'kotlin',
    description: 'Core data models for scenes, actors, biomes, gestures, and aspect formats',
    content: `package com.bharatai.pocketengine.model

import java.util.UUID

enum class AspectFormat(val label: String, val width: Int, val height: Int) {
    REEL_9_16("9:16 Reels / Shorts", 720, 1280),
    CINEMA_16_9("16:9 Cinema", 1280, 720)
}

enum class VoiceLang(val label: String, val tag: String) {
    HINDI("Hindi (हिन्दी)", "hi-IN"),
    ENGLISH("English (India)", "en-IN")
}

enum class EnvBiome(val id: Int, val label: String) {
    AVATAR_NIGHT(0, "Avatar Mystic Glow"),
    FIRE_BATTLE(1, "Fire & Embers"),
    MONSOON_RAIN(2, "Monsoon Storm"),
    DESERT_MYSTERY(3, "Jaisalmer / Desert"),
    SACRED_RIVER(4, "Himalayan River")
}

enum class GestureAction(val label: String) {
    TALK_WAVE("Explaining / Hand Gesture"),
    HERO_RAISE("Heroic Raise"),
    POINTING("Pointing Forward"),
    WALKING("Walking Forward"),
    THINKING("Calm / Contemplating")
}

enum class EmotionMood(val label: String) {
    CALM("Calm"),
    HEROIC("Heroic"),
    INTENSE("Intense / Urgent"),
    MYSTERIOUS("Mysterious")
}

data class ActorProfile(
    val id: String = UUID.randomUUID().toString(),
    val name: String,
    val isFemale: Boolean,
    val accentColor: Int,
    val robeColor: Int,
    val pitch: Float = if (isFemale) 1.2f else 0.90f,
    val speechRate: Float = 0.94f,
    val portraitUri: String? = null,
    val glbModelUri: String? = null
)

data class DirectedScene(
    val id: String = UUID.randomUUID().toString(),
    val index: Int,
    val locationTitle: String,
    val hookBanner: String,
    val dialogue: String,
    val actor: ActorProfile,
    val biome: EnvBiome,
    val gesture: GestureAction,
    val emotion: EmotionMood,
    val cameraZoomStart: Float,
    val cameraZoomEnd: Float,
    val cameraPanRange: Float,
    val durationMs: Long = 3500L,
    val audioWavPath: String? = null,
    val lipSyncEnvelope: FloatArray = floatArrayOf()
)
`,
  },
  {
    path: 'app/src/main/java/com/bharatai/pocketengine/brain/LocalDirectorBrain.kt',
    language: 'kotlin',
    description: 'On-device Hindi & English story director for biome, emotion, gesture, and camera motion',
    content: `package com.bharatai.pocketengine.brain

import com.bharatai.pocketengine.model.*

class LocalDirectorBrain {

    fun directStory(
        rawIdea: String,
        language: VoiceLang,
        actors: List<ActorProfile>
    ): List<DirectedScene> {
        val clean = rawIdea.trim().ifEmpty {
            if (language == VoiceLang.HINDI) {
                "1987 में राजस्थान के जैसलमेर बॉर्डर पर आसमान से एक रहस्यमयी रोशनी उतरी। अचानक तेज आंधी और आग की चिंगारियां फैल गईं। अब इस अनसुलझे रहस्य के पीछे का सच सामने आ रहा है।"
            } else {
                "In 2026 inside a glowing Himalayan valley, Arjun walks toward the sacred river. Suddenly monsoon thunder strikes across the mountains. Together we must protect the ancient light."
            }
        }

        val sentences = clean
            .split(Regex("[।.!?\\n]+"))
            .map { it.trim() }
            .filter { it.length > 2 }
            .ifEmpty { listOf(clean) }

        val yearOrDateRegex = Regex("(\\\\b\\\\d{4}\\\\b|\\\\d{1,2}\\\\s+(January|February|March|April|May|June|July|August|September|October|November|December|जनवरी|फरवरी|मार्च|अप्रैल|मई|जून|जुलाई|अगस्त|सितंबर|अक्टूबर|नवंबर|दिसंबर))", RegexOption.IGNORE_CASE)

        return sentences.take(12).mapIndexed { idx, line ->
            val actor = matchActorInLine(line, actors, idx)
            val biome = detectBiome(line)
            val emotion = detectEmotion(line)
            val gesture = detectGesture(line, emotion, idx)
            val location = detectLocationTitle(line, biome, language)
            val hook = yearOrDateRegex.find(line)?.value?.uppercase() ?: ""

            val zoomIn = idx % 2 == 0
            DirectedScene(
                index = idx + 1,
                locationTitle = location,
                hookBanner = hook,
                dialogue = line,
                actor = actor,
                biome = biome,
                gesture = gesture,
                emotion = emotion,
                cameraZoomStart = if (zoomIn) 1.0f else 1.22f,
                cameraZoomEnd = if (zoomIn) 1.24f else 1.0f,
                cameraPanRange = if (idx % 3 == 0) 0.12f else -0.12f
            )
        }
    }

    private fun matchActorInLine(line: String, actors: List<ActorProfile>, idx: Int): ActorProfile {
        val explicit = actors.firstOrNull { line.contains(it.name, ignoreCase = true) }
        return explicit ?: actors[idx % actors.size]
    }

    private fun detectBiome(text: String): EnvBiome {
        val l = text.lowercase()
        return when {
            l.contains("fire") || l.contains("diwali") || l.contains("blast") || text.contains("आग") || text.contains("चिंगार") || text.contains("पटाख") -> EnvBiome.FIRE_BATTLE
            l.contains("rain") || l.contains("storm") || l.contains("thunder") || text.contains("बारिश") || text.contains("तूफान") -> EnvBiome.MONSOON_RAIN
            l.contains("desert") || l.contains("jaisalmer") || l.contains("border") || l.contains("sand") || text.contains("जैसलमेर") || text.contains("रेगिस्तान") || text.contains("आंधी") -> EnvBiome.DESERT_MYSTERY
            l.contains("river") || l.contains("water") || l.contains("ganga") || text.contains("नदी") || text.contains("झरना") || text.contains("पानी") -> EnvBiome.SACRED_RIVER
            else -> EnvBiome.AVATAR_NIGHT
        }
    }

    private fun detectEmotion(text: String): EmotionMood {
        val l = text.lowercase()
        return when {
            l.contains("!") || l.contains("danger") || l.contains("attack") || l.contains("fire") || text.contains("खतरा") || text.contains("आग") -> EmotionMood.INTENSE
            l.contains("protect") || l.contains("rise") || l.contains("warrior") || text.contains("रक्षा") || text.contains("योद्धा") -> EmotionMood.HEROIC
            l.contains("secret") || l.contains("mystery") || l.contains("sudden") || text.contains("रहस्य") || text.contains("अचानक") -> EmotionMood.MYSTERIOUS
            else -> EmotionMood.CALM
        }
    }

    private fun detectGesture(text: String, mood: EmotionMood, idx: Int): GestureAction {
        val l = text.lowercase()
        return when {
            l.contains("walk") || l.contains("go") || text.contains("चल") || text.contains("आगे") -> GestureAction.WALKING
            mood == EmotionMood.HEROIC -> GestureAction.HERO_RAISE
            mood == EmotionMood.INTENSE || l.contains("look") || text.contains("देख") -> GestureAction.POINTING
            mood == EmotionMood.MYSTERIOUS && idx % 2 == 1 -> GestureAction.THINKING
            else -> GestureAction.TALK_WAVE
        }
    }

    private fun detectLocationTitle(text: String, biome: EnvBiome, lang: VoiceLang): String {
        val l = text.lowercase()
        return when {
            l.contains("jaisalmer") || text.contains("जैसलमेर") -> "JAISALMER BORDER"
            l.contains("himalaya") || text.contains("हिमालय") -> "HIMALAYAN PEAKS"
            l.contains("forest") || text.contains("जंगल") -> "BIOLUMINESCENT FOREST"
            biome == EnvBiome.FIRE_BATTLE -> if (lang == VoiceLang.HINDI) "अग्नि क्षेत्र" else "EMBER ZONE"
            biome == EnvBiome.MONSOON_RAIN -> if (lang == VoiceLang.HINDI) "तूफानी घाटी" else "STORM VALLEY"
            biome == EnvBiome.SACRED_RIVER -> if (lang == VoiceLang.HINDI) "पवित्र नदी" else "SACRED RIVER"
            biome == EnvBiome.DESERT_MYSTERY -> if (lang == VoiceLang.HINDI) "सीमा क्षेत्र" else "FRONTIER OUTPOST"
            else -> if (lang == VoiceLang.HINDI) "रहस्यमयी लोक" else "MYSTIC REALM"
        }
    }
}
`,
  },
  {
    path: 'app/src/main/java/com/bharatai/pocketengine/audio/AudioMixEngine.kt',
    language: 'kotlin',
    description: 'TTS synthesis, 30 FPS PCM lip-sync envelope extraction, and procedural BGM/SFX mixer',
    content: `package com.bharatai.pocketengine.audio

import android.content.Context
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import com.bharatai.pocketengine.model.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Locale
import java.util.UUID
import kotlin.coroutines.resume
import kotlin.math.PI
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.random.Random

class AudioMixEngine(context: Context) {

    private val appContext = context.applicationContext
    private var tts: TextToSpeech? = null
    private var ready = false

    companion object {
        const val TARGET_SAMPLE_RATE = 22050
    }

    private suspend fun ensureTts(): Boolean = suspendCancellableCoroutine { cont ->
        if (tts != null && ready) {
            cont.resume(true)
            return@suspendCancellableCoroutine
        }
        tts = TextToSpeech(appContext) { status ->
            ready = (status == TextToSpeech.SUCCESS)
            if (cont.isActive) cont.resume(ready)
        }
    }

    suspend fun speakPreview(text: String, actor: ActorProfile, lang: VoiceLang) {
        if (!ensureTts()) return
        val engine = tts ?: return
        applyVoice(engine, actor, lang)
        engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, UUID.randomUUID().toString())
    }

    suspend fun synthesizeSceneAndExtractLipSync(
        scene: DirectedScene,
        lang: VoiceLang,
        rawTtsFile: File
    ): Triple<File, Long, FloatArray> = withContext(Dispatchers.IO) {
        val ok = ensureTts()
        val engine = tts
        var synthesized = false

        if (ok && engine != null && scene.dialogue.isNotBlank()) {
            applyVoice(engine, scene.actor, lang)
            val id = UUID.randomUUID().toString()
            synthesized = suspendCancellableCoroutine { cont ->
                engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(utteranceId: String?) {}
                    override fun onDone(utteranceId: String?) {
                        if (utteranceId == id && cont.isActive) cont.resume(true)
                    }
                    @Deprecated("Deprecated in Java")
                    override fun onError(utteranceId: String?) {
                        if (utteranceId == id && cont.isActive) cont.resume(false)
                    }
                    override fun onError(utteranceId: String?, errorCode: Int) {
                        if (utteranceId == id && cont.isActive) cont.resume(false)
                    }
                })
                val params = Bundle().apply { putString(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, id) }
                if (engine.synthesizeToFile(scene.dialogue, params, rawTtsFile, id) != TextToSpeech.SUCCESS && cont.isActive) {
                    cont.resume(false)
                }
            }
        }

        val pcm22k = if (synthesized && rawTtsFile.exists() && rawTtsFile.length() > 64) {
            readAndResampleWavTo22k(rawTtsFile)
        } else {
            val estSamples = ((scene.dialogue.length * 65L).coerceIn(2500L, 7000L) * TARGET_SAMPLE_RATE / 1000L).toInt()
            ShortArray(estSamples)
        }

        val padded = ShortArray(pcm22k.size + (TARGET_SAMPLE_RATE * 35 / 100))
        pcm22k.copyInto(padded)

        val durationMs = (padded.size * 1000L) / TARGET_SAMPLE_RATE
        val envelope30Fps = compute30FpsLipSync(padded, TARGET_SAMPLE_RATE)

        writeMonoWav(rawTtsFile, padded, TARGET_SAMPLE_RATE)
        Triple(rawTtsFile, durationMs.coerceAtLeast(2200L), envelope30Fps)
    }

    suspend fun mixMasterMovieAudio(
        scenes: List<DirectedScene>,
        outMixedWav: File
    ): File = withContext(Dispatchers.IO) {
        val totalSamples = scenes.sumOf { ((it.durationMs * TARGET_SAMPLE_RATE) / 1000L).toInt() }
        val master = ShortArray(totalSamples.coerceAtLeast(TARGET_SAMPLE_RATE))

        var cursor = 0
        val rng = Random(77)
        var lpFilter = 0f

        for (scene in scenes) {
            val sceneSamples = ((scene.durationMs * TARGET_SAMPLE_RATE) / 1000L).toInt()
            val voicePcm = scene.audioWavPath?.let { path ->
                val f = File(path)
                if (f.exists()) readAndResampleWavTo22k(f) else ShortArray(0)
            } ?: ShortArray(0)

            for (i in 0 until sceneSamples) {
                val globalIdx = cursor + i
                if (globalIdx >= master.size) break
                val t = globalIdx.toDouble() / TARGET_SAMPLE_RATE

                val drone = (
                    sin(2.0 * PI * 73.42 * t) * 0.45 +
                        sin(2.0 * PI * 110.0 * t) * 0.30 +
                        sin(2.0 * PI * 146.83 * t) * 0.20
                    ) * (0.75 + 0.25 * sin(2.0 * PI * 0.18 * t)) * 2200.0

                val white = rng.nextFloat() * 2f - 1f
                lpFilter = lpFilter * 0.92f + white * 0.08f
                val sfx = when (scene.biome) {
                    EnvBiome.MONSOON_RAIN -> lpFilter * 2100f
                    EnvBiome.DESERT_MYSTERY -> lpFilter * 1500f * (0.6f + 0.4f * sin(2.0 * PI * 0.25 * t).toFloat())
                    EnvBiome.FIRE_BATTLE -> (if (rng.nextInt(180) == 0) white * 4500f else lpFilter * 950f)
                    EnvBiome.SACRED_RIVER -> lpFilter * 1650f
                    EnvBiome.AVATAR_NIGHT -> sin(2.0 * PI * 220.0 * t).toFloat() * 350f
                }

                val vSample = if (i < voicePcm.size) voicePcm[i].toFloat() else 0f
                val mixed = (vSample * 0.95f + drone.toFloat() + sfx).toInt().coerceIn(-32767, 32767)
                master[globalIdx] = mixed.toShort()
            }
            cursor += sceneSamples
        }

        writeMonoWav(outMixedWav, master, TARGET_SAMPLE_RATE)
        outMixedWav
    }

    private fun compute30FpsLipSync(pcm: ShortArray, sampleRate: Int): FloatArray {
        val samplesPerFrame = (sampleRate / 30).coerceAtLeast(1)
        val frames = (pcm.size / samplesPerFrame).coerceAtLeast(1)
        return FloatArray(frames) { f ->
            val start = f * samplesPerFrame
            val end = (start + samplesPerFrame).coerceAtMost(pcm.size)
            var sumSq = 0.0
            for (i in start until end) {
                val n = pcm[i] / 32768.0
                sumSq += n * n
            }
            val rms = sqrt(sumSq / (end - start).coerceAtLeast(1)).toFloat()
            (rms * 5.2f).coerceIn(0f, 1f)
        }
    }

    private fun applyVoice(engine: TextToSpeech, actor: ActorProfile, lang: VoiceLang) {
        val locale = Locale.forLanguageTag(lang.tag)
        engine.language = if (engine.isLanguageAvailable(locale) >= TextToSpeech.LANG_AVAILABLE) locale else Locale.US
        engine.setPitch(actor.pitch.coerceIn(0.65f, 1.55f))
        engine.setSpeechRate(actor.speechRate.coerceIn(0.65f, 1.45f))
    }

    private fun readAndResampleWavTo22k(file: File): ShortArray {
        val bytes = file.readBytes()
        if (bytes.size < 44) return ShortArray(0)
        val bb = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)

        var sampleRate = 16000
        var channels = 1
        var bitsPerSample = 16
        var dataOffset = 44
        var dataLength = bytes.size - 44

        var pos = 12
        while (pos + 8 <= bytes.size) {
            val chunkId = String(bytes, pos, 4)
            val chunkSize = bb.getInt(pos + 4).coerceAtLeast(0)
            if (chunkId == "fmt " && pos + 24 <= bytes.size) {
                channels = bb.getShort(pos + 10).toInt().coerceAtLeast(1)
                sampleRate = bb.getInt(pos + 12).coerceAtLeast(8000)
                bitsPerSample = bb.getShort(pos + 22).toInt().coerceAtLeast(8)
            } else if (chunkId == "data") {
                dataOffset = pos + 8
                dataLength = chunkSize.coerceAtMost(bytes.size - dataOffset)
                break
            }
            pos += 8 + chunkSize + (chunkSize and 1)
        }

        if (bitsPerSample != 16 || dataLength < 2) return ShortArray(0)
        val totalFrames = dataLength / (2 * channels)
        val monoSrc = ShortArray(totalFrames) { i ->
            var sum = 0
            val base = dataOffset + i * 2 * channels
            for (c in 0 until channels) {
                sum += bb.getShort(base + c * 2).toInt()
            }
            (sum / channels).toShort()
        }

        if (sampleRate == TARGET_SAMPLE_RATE) return monoSrc
        val ratio = sampleRate.toDouble() / TARGET_SAMPLE_RATE.toDouble()
        val outLen = (monoSrc.size / ratio).toInt().coerceAtLeast(1)
        return ShortArray(outLen) { i ->
            val srcPos = i * ratio
            val idx = srcPos.toInt().coerceIn(0, monoSrc.lastIndex)
            val next = (idx + 1).coerceAtMost(monoSrc.lastIndex)
            val frac = (srcPos - idx).toFloat()
            (monoSrc[idx] * (1f - frac) + monoSrc[next] * frac).toInt().toShort()
        }
    }

    private fun writeMonoWav(file: File, pcm: ShortArray, sampleRate: Int) {
        val dataSize = pcm.size * 2
        val totalSize = 36 + dataSize
        FileOutputStream(file).use { out ->
            val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN).apply {
                put("RIFF".toByteArray())
                putInt(totalSize)
                put("WAVE".toByteArray())
                put("fmt ".toByteArray())
                putInt(16)
                putShort(1.toShort())
                putShort(1.toShort())
                putInt(sampleRate)
                putInt(sampleRate * 2)
                putShort(2.toShort())
                putShort(16.toShort())
                put("data".toByteArray())
                putInt(dataSize)
            }
            out.write(header.array())
            val dataBuf = ByteBuffer.allocate(dataSize).order(ByteOrder.LITTLE_ENDIAN)
            for (s in pcm) dataBuf.putShort(s)
            out.write(dataBuf.array())
        }
    }

    fun shutdown() {
        tts?.stop()
        tts?.shutdown()
        tts = null
        ready = false
    }
}
`,
  },
  {
    path: 'app/src/main/java/com/bharatai/pocketengine/graphics/GpuSceneRenderer.kt',
    language: 'kotlin',
    description: 'EGL14 + OpenGL ES 2.0 fragment shader world + articulated character rig + MediaCodec H.264 encoder',
    content: `package com.bharatai.pocketengine.graphics

import android.content.Context
import android.graphics.*
import android.media.*
import android.net.Uri
import android.opengl.*
import android.view.Surface
import com.bharatai.pocketengine.model.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import kotlin.math.cos
import kotlin.math.sin
import kotlin.random.Random

class GpuSceneRenderer(private val context: Context) {

    suspend fun renderGpuVideoOnly(
        scenes: List<DirectedScene>,
        format: AspectFormat,
        outputVideoMp4: File,
        onProgress: (Int) -> Unit
    ): File = withContext(Dispatchers.Default) {
        if (outputVideoMp4.exists()) outputVideoMp4.delete()

        val width = format.width
        val height = format.height
        val fps = 30

        val portraits = scenes.map { it.actor.id }.distinct().associateWith { actorId ->
            val uri = scenes.firstOrNull { it.actor.id == actorId }?.actor?.portraitUri
            loadPortrait(uri)
        }

        val mediaFormat = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height).apply {
            setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
            setInteger(MediaFormat.KEY_BIT_RATE, 4_200_000)
            setInteger(MediaFormat.KEY_FRAME_RATE, fps)
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
        }

        val encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
        var inputSurface: Surface? = null
        var muxer: MediaMuxer? = null
        var eglDisplay = EGL14.EGL_NO_DISPLAY
        var eglContext = EGL14.EGL_NO_CONTEXT
        var eglSurface = EGL14.EGL_NO_SURFACE
        val overlayBitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val overlayCanvas = Canvas(overlayBitmap)

        try {
            encoder.configure(mediaFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            inputSurface = encoder.createInputSurface()
            encoder.start()

            muxer = MediaMuxer(outputVideoMp4.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            var trackIndex = -1
            var muxerStarted = false
            val bufferInfo = MediaCodec.BufferInfo()

            eglDisplay = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
            val vers = IntArray(2)
            EGL14.eglInitialize(eglDisplay, vers, 0, vers, 1)
            val cfgAttr = intArrayOf(
                EGL14.EGL_RED_SIZE, 8,
                EGL14.EGL_GREEN_SIZE, 8,
                EGL14.EGL_BLUE_SIZE, 8,
                EGL14.EGL_ALPHA_SIZE, 8,
                EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT,
                0x3142, 1,
                EGL14.EGL_NONE
            )
            val configs = arrayOfNulls<EGLConfig>(1)
            val numCfg = IntArray(1)
            EGL14.eglChooseConfig(eglDisplay, cfgAttr, 0, configs, 0, 1, numCfg, 0)
            eglContext = EGL14.eglCreateContext(
                eglDisplay, configs[0], EGL14.EGL_NO_CONTEXT,
                intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE), 0
            )
            eglSurface = EGL14.eglCreateWindowSurface(eglDisplay, configs[0], inputSurface, intArrayOf(EGL14.EGL_NONE), 0)
            EGL14.eglMakeCurrent(eglDisplay, eglSurface, eglSurface, eglContext)

            val gl = GlShaderScene(width, height, overlayBitmap)

            val totalFramesAll = scenes.sumOf { ((it.durationMs * fps) / 1000L).toInt().coerceAtLeast(30) }
            var globalFrame = 0

            for (scene in scenes) {
                val sceneFrames = ((scene.durationMs * fps) / 1000L).toInt().coerceAtLeast(30)
                val portrait = portraits[scene.actor.id]

                for (f in 0 until sceneFrames) {
                    val state = drainEncoder(encoder, muxer, bufferInfo, trackIndex, muxerStarted, endOfStream = false)
                    trackIndex = state.first
                    muxerStarted = state.second

                    val p = f.toFloat() / (sceneFrames - 1).coerceAtLeast(1)
                    val audioAmp = scene.lipSyncEnvelope.getOrElse(f) { 0f }
                    val timeSec = globalFrame.toFloat() / fps

                    overlayBitmap.eraseColor(Color.TRANSPARENT)
                    drawArticulatedCharacterAndHud(
                        canvas = overlayCanvas,
                        w = width.toFloat(),
                        h = height.toFloat(),
                        scene = scene,
                        portrait = portrait,
                        progress = p,
                        timeSec = timeSec,
                        audioAmp = audioAmp
                    )

                    val zoom = scene.cameraZoomStart + (scene.cameraZoomEnd - scene.cameraZoomStart) * p
                    val pan = sin(p * Math.PI).toFloat() * scene.cameraPanRange
                    gl.draw(
                        timeSec = timeSec,
                        envType = scene.biome.id.toFloat(),
                        zoom = zoom,
                        pan = pan,
                        audioEnergy = audioAmp,
                        overlay = overlayBitmap,
                        isFirstFrame = (globalFrame == 0)
                    )

                    val ptsNs = globalFrame * 1_000_000_000L / fps
                    EGLExt.eglPresentationTimeANDROID(eglDisplay, eglSurface, ptsNs)
                    EGL14.eglSwapBuffers(eglDisplay, eglSurface)

                    globalFrame++
                    if (globalFrame % 10 == 0) {
                        onProgress(((globalFrame * 85) / totalFramesAll.coerceAtLeast(1)).coerceIn(1, 85))
                    }
                }
            }

            encoder.signalEndOfInputStream()
            drainEncoder(encoder, muxer, bufferInfo, trackIndex, muxerStarted, endOfStream = true)
            gl.release()
            outputVideoMp4
        } finally {
            portraits.values.forEach { it?.recycle() }
            overlayBitmap.recycle()
            if (eglDisplay !== EGL14.EGL_NO_DISPLAY) {
                EGL14.eglMakeCurrent(eglDisplay, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
                if (eglSurface !== EGL14.EGL_NO_SURFACE) EGL14.eglDestroySurface(eglDisplay, eglSurface)
                if (eglContext !== EGL14.EGL_NO_CONTEXT) EGL14.eglDestroyContext(eglDisplay, eglContext)
                EGL14.eglTerminate(eglDisplay)
            }
            runCatching { encoder.stop() }
            runCatching { encoder.release() }
            runCatching { inputSurface?.release() }
            runCatching { muxer?.stop() }
            runCatching { muxer?.release() }
        }
    }

    private fun drainEncoder(
        encoder: MediaCodec,
        muxer: MediaMuxer,
        info: MediaCodec.BufferInfo,
        currentTrack: Int,
        currentStarted: Boolean,
        endOfStream: Boolean
    ): Pair<Int, Boolean> {
        var trackIndex = currentTrack
        var muxerStarted = currentStarted

        while (true) {
            val outIndex = encoder.dequeueOutputBuffer(info, if (endOfStream) 10_000 else 0)
            if (outIndex == MediaCodec.INFO_TRY_AGAIN_LATER) {
                if (!endOfStream) break
            } else if (outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                if (!muxerStarted) {
                    trackIndex = muxer.addTrack(encoder.outputFormat)
                    muxer.start()
                    muxerStarted = true
                }
            } else if (outIndex >= 0) {
                val encodedData = encoder.getOutputBuffer(outIndex)
                if (encodedData != null && info.size > 0 && (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0 && muxerStarted) {
                    encodedData.position(info.offset)
                    encodedData.limit(info.offset + info.size)
                    muxer.writeSampleData(trackIndex, encodedData, info)
                }
                encoder.releaseOutputBuffer(outIndex, false)
                if ((info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) break
            }
        }
        return trackIndex to muxerStarted
    }

    private fun drawArticulatedCharacterAndHud(
        canvas: Canvas,
        w: Float,
        h: Float,
        scene: DirectedScene,
        portrait: Bitmap?,
        progress: Float,
        timeSec: Float,
        audioAmp: Float
    ) {
        val isVertical = h > w
        val cx = w * 0.5f + sin(timeSec * 0.9f) * 14f
        val scale = if (isVertical) 1.0f else 0.84f
        val walkBounce = if (scene.gesture == GestureAction.WALKING) kotlin.math.abs(sin(timeSec * 6.0f)) * 14f else 0f
        val breathe = sin(timeSec * 2.4f) * 4f
        val baseY = (if (isVertical) h * 0.67f else h * 0.72f) - walkBounce

        canvas.save()
        canvas.translate(cx, baseY)
        canvas.scale(scale, scale)

        val shadowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x77000000 }
        canvas.drawOval(-130f, 120f, 130f, 165f, shadowPaint)

        val legPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = 0xFF1B263B.toInt()
            strokeWidth = 34f
            strokeCap = Paint.Cap.ROUND
        }
        val stride = if (scene.gesture == GestureAction.WALKING) sin(timeSec * 6.0f) * 48f else 0f
        canvas.drawLine(-34f, -10f, -38f + stride, 135f, legPaint)
        canvas.drawLine(34f, -10f, 38f - stride, 135f, legPaint)

        val robePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = scene.actor.robeColor }
        val trimPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = scene.actor.accentColor
            style = Paint.Style.STROKE
            strokeWidth = 5f
        }
        val torso = Path().apply {
            moveTo(-78f, -210f + breathe)
            lineTo(78f, -210f + breathe)
            lineTo(105f, 30f)
            lineTo(-105f, 30f)
            close()
        }
        canvas.drawPath(torso, robePaint)
        canvas.drawPath(torso, trimPaint)

        val armPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = 0xFFD9A077.toInt()
            strokeWidth = 24f
            strokeCap = Paint.Cap.ROUND
        }
        val (lAngle, rAngle) = when (scene.gesture) {
            GestureAction.TALK_WAVE -> (-0.4f + sin(timeSec * 4.5f) * 0.35f) to (0.65f + cos(timeSec * 5.2f) * 0.45f)
            GestureAction.HERO_RAISE -> (-2.4f + sin(timeSec * 2f) * 0.1f) to (0.5f)
            GestureAction.POINTING -> (-0.3f) to (-1.35f + sin(timeSec * 3f) * 0.12f)
            GestureAction.WALKING -> (sin(timeSec * 6f) * 0.55f) to (-sin(timeSec * 6f) * 0.55f)
            GestureAction.THINKING -> (-0.25f) to (-2.1f)
        }
        drawArm(canvas, -75f, -195f + breathe, lAngle, armPaint)
        drawArm(canvas, 75f, -195f + breathe, rAngle, armPaint)

        val headY = -285f + breathe - audioAmp * 6f
        val headTilt = sin(timeSec * 1.8f) * 5f + (audioAmp * 4f)
        canvas.save()
        canvas.translate(0f, headY)
        canvas.rotate(headTilt)

        if (portrait != null) {
            val r = RectF(-72f, -72f, 72f, 72f)
            val clip = Path().apply { addOval(r, Path.Direction.CW) }
            canvas.save()
            canvas.clipPath(clip)
            canvas.drawBitmap(portrait, null, r, Paint(Paint.FILTER_BITMAP_FLAG))
            canvas.restore()
            canvas.drawOval(r, trimPaint)
        } else {
            val skinPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFFE0AC82.toInt() }
            val hairPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFF141824.toInt() }
            canvas.drawCircle(0f, -10f, 68f, hairPaint)
            canvas.drawCircle(0f, 0f, 60f, skinPaint)

            val blink = ((timeSec % 3.6f) > 3.45f)
            val eyePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFF0D1321.toInt() }
            if (blink) {
                eyePaint.strokeWidth = 4f
                canvas.drawLine(-28f, -10f, -10f, -10f, eyePaint)
                canvas.drawLine(10f, -10f, 28f, -10f, eyePaint)
            } else {
                canvas.drawCircle(-20f, -10f, 6.5f, eyePaint)
                canvas.drawCircle(20f, -10f, 6.5f, eyePaint)
            }

            val browPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = 0xFF141824.toInt()
                strokeWidth = 5f
                strokeCap = Paint.Cap.ROUND
            }
            val tilt = when (scene.emotion) {
                EmotionMood.INTENSE, EmotionMood.HEROIC -> 7f
                EmotionMood.MYSTERIOUS -> -4f
                EmotionMood.CALM -> 0f
            }
            canvas.drawLine(-30f, -24f - tilt, -10f, -24f + tilt, browPaint)
            canvas.drawLine(10f, -24f + tilt, 30f, -24f - tilt, browPaint)

            val mouthOpen = (4f + audioAmp * 22f).coerceIn(3f, 26f)
            val mouthPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFF6B1D24.toInt() }
            canvas.drawOval(-16f, 22f - mouthOpen * 0.4f, 16f, 22f + mouthOpen * 0.6f, mouthPaint)
        }
        canvas.restore()
        canvas.restore()

        drawParticles(canvas, w, h, scene.biome, timeSec)

        val barPaint = Paint().apply { color = 0xAA000000.toInt() }
        canvas.drawRect(0f, 0f, w, 92f, barPaint)
        canvas.drawRect(0f, h - 165f, w, h, barPaint)

        val metaPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = scene.actor.accentColor
            textSize = 26f
            typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
        }
        canvas.drawText("SCENE \${scene.index}  •  \${scene.locationTitle}", 32f, 56f, metaPaint)

        if (scene.hookBanner.isNotBlank()) {
            val hookAlpha = (progress * 4f).coerceIn(0f, 1f)
            val hookPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.WHITE
                alpha = (hookAlpha * 255).toInt()
                textSize = if (isVertical) 54f else 48f
                textAlign = Paint.Align.CENTER
                typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
                setShadowLayer(12f, 0f, 4f, Color.BLACK)
            }
            canvas.drawText(scene.hookBanner, w * 0.5f, h * 0.22f, hookPaint)
        }

        drawWrappedSubtitles(canvas, "\${scene.actor.name}: \${scene.dialogue}", w, h)
    }

    private fun drawArm(canvas: Canvas, sx: Float, sy: Float, angleRad: Float, paint: Paint) {
        val ex = sx + sin(angleRad) * 95f
        val ey = sy + cos(angleRad) * 95f
        canvas.drawLine(sx, sy, ex, ey, paint)
    }

    private fun drawParticles(canvas: Canvas, w: Float, h: Float, biome: EnvBiome, t: Float) {
        val rng = Random(42)
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        when (biome) {
            EnvBiome.MONSOON_RAIN -> {
                p.color = 0x88BDE0FE.toInt()
                p.strokeWidth = 3f
                repeat(65) {
                    val x = rng.nextFloat() * w
                    val y = (rng.nextFloat() * h + t * 850f) % h
                    canvas.drawLine(x, y, x - 14f, y + 40f, p)
                }
            }
            EnvBiome.FIRE_BATTLE -> {
                repeat(50) {
                    p.color = if (it % 2 == 0) 0xCCFF6D00.toInt() else 0xBBFFD600.toInt()
                    val x = rng.nextFloat() * w + sin(t * 2f + it) * 24f
                    val y = h - ((rng.nextFloat() * h + t * 240f) % h)
                    canvas.drawCircle(x, y, rng.nextFloat() * 5f + 2f, p)
                }
            }
            EnvBiome.DESERT_MYSTERY -> {
                p.color = 0x55E9C46A.toInt()
                p.strokeWidth = 2.5f
                repeat(35) {
                    val x = (rng.nextFloat() * w + t * 380f) % w
                    val y = rng.nextFloat() * h
                    canvas.drawLine(x, y, x + 70f, y - 5f, p)
                }
            }
            EnvBiome.AVATAR_NIGHT, EnvBiome.SACRED_RIVER -> {
                p.color = 0xAA72EFDD.toInt()
                repeat(50) {
                    val x = rng.nextFloat() * w
                    val y = rng.nextFloat() * h * 0.8f
                    val r = (rng.nextFloat() * 3.5f + 1.5f) * (0.6f + 0.4f * sin(t * 3f + it))
                    canvas.drawCircle(x, y, r, p)
                }
            }
        }
    }

    private fun drawWrappedSubtitles(canvas: Canvas, text: String, w: Float, h: Float) {
        val p = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            textSize = 30f
            textAlign = Paint.Align.CENTER
            typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
        }
        val words = text.split(" ")
        val lines = mutableListOf<String>()
        val cur = StringBuilder()
        val maxChars = if (w < 900f) 34 else 58
        for (word in words) {
            if (cur.length + word.length > maxChars) {
                lines.add(cur.toString().trim())
                cur.clear()
            }
            cur.append(word).append(" ")
        }
        if (cur.isNotBlank()) lines.add(cur.toString().trim())
        val startY = h - if (lines.size > 1) 95f else 68f
        lines.take(2).forEachIndexed { idx, line ->
            canvas.drawText(line, w * 0.5f, startY + idx * 38f, p)
        }
    }

    private fun loadPortrait(uri: String?): Bitmap? {
        if (uri.isNullOrBlank()) return null
        return runCatching {
            context.contentResolver.openInputStream(Uri.parse(uri))?.use { BitmapFactory.decodeStream(it) }
        }.getOrNull()
    }

    private class GlShaderScene(
        private val width: Int,
        private val height: Int,
        initialBitmap: Bitmap
    ) {
        private val program: Int
        private val vertexBuf: FloatBuffer
        private val uvBuf: FloatBuffer
        private val texIds = IntArray(1)

        private val uTimeLoc: Int
        private val uEnvLoc: Int
        private val uZoomLoc: Int
        private val uPanLoc: Int
        private val uAudioLoc: Int
        private val uTexLoc: Int

        init {
            val vs = """
                attribute vec2 aPos;
                attribute vec2 aUv;
                varying vec2 vUv;
                void main() {
                    vUv = aUv;
                    gl_Position = vec4(aPos, 0.0, 1.0);
                }
            """.trimIndent()

            val fs = """
                precision mediump float;
                varying vec2 vUv;
                uniform float uTime;
                uniform float uEnvType;
                uniform float uZoom;
                uniform float uPan;
                uniform float uAudio;
                uniform sampler2D uOverlayTex;

                float waveNoise(vec2 p) {
                    return sin(p.x * 3.1 + uTime * 0.4) * cos(p.y * 2.7 - uTime * 0.3);
                }

                void main() {
                    vec2 camUv = (vUv - 0.5) / uZoom + 0.5;
                    camUv.x += uPan * (1.0 - vUv.y * 0.6);

                    vec3 skyTop = vec3(0.02, 0.05, 0.14);
                    vec3 skyBot = vec3(0.04, 0.32, 0.45);
                    if (uEnvType > 0.5 && uEnvType < 1.5) {
                        skyTop = vec3(0.15, 0.02, 0.02);
                        skyBot = vec3(0.65, 0.20, 0.05);
                    } else if (uEnvType >= 1.5 && uEnvType < 2.5) {
                        skyTop = vec3(0.04, 0.08, 0.14);
                        skyBot = vec3(0.14, 0.24, 0.36);
                    } else if (uEnvType >= 2.5 && uEnvType < 3.5) {
                        skyTop = vec3(0.07, 0.08, 0.16);
                        skyBot = vec3(0.55, 0.35, 0.18);
                    } else if (uEnvType >= 3.5) {
                        skyTop = vec3(0.03, 0.12, 0.24);
                        skyBot = vec3(0.08, 0.45, 0.58);
                    }

                    vec3 col = mix(skyBot, skyTop, clamp(camUv.y, 0.0, 1.0));
                    vec2 orbPos = vec2(0.5 + uPan * 0.4, 0.68);
                    float dOrb = length(camUv - orbPos);
                    col += vec3(0.35, 0.80, 0.95) * (0.045 + uAudio * 0.04) / (dOrb + 0.08);

                    float mBack = 0.48 + 0.07 * sin(camUv.x * 6.0 + uPan * 1.5) + 0.03 * cos(camUv.x * 13.0);
                    if (camUv.y < mBack) col = mix(col, vec3(0.04, 0.08, 0.14), 0.78);

                    float mFront = 0.36 + 0.05 * sin(camUv.x * 9.0 + uPan * 3.5 + 1.2);
                    if (camUv.y < mFront) col = mix(col, vec3(0.02, 0.04, 0.08), 0.90);

                    if (camUv.y < 0.26) {
                        float shimmer = 0.5 + 0.5 * waveNoise(vec2(camUv.x * 18.0, camUv.y * 40.0));
                        col = mix(vec3(0.01, 0.03, 0.07), skyBot * 0.55, shimmer * 0.45);
                    }

                    vec2 ovUv = vec2(vUv.x, 1.0 - vUv.y);
                    vec4 ov = texture2D(uOverlayTex, ovUv);
                    vec3 finalRgb = col * (1.0 - ov.a) + ov.rgb;
                    gl_FragColor = vec4(finalRgb, 1.0);
                }
            """.trimIndent()

            val vShader = compile(GLES20.GL_VERTEX_SHADER, vs)
            val fShader = compile(GLES20.GL_FRAGMENT_SHADER, fs)
            program = GLES20.glCreateProgram()
            GLES20.glAttachShader(program, vShader)
            GLES20.glAttachShader(program, fShader)
            GLES20.glLinkProgram(program)

            val verts = floatArrayOf(-1f, -1f, 1f, -1f, -1f, 1f, 1f, 1f)
            val uvs = floatArrayOf(0f, 0f, 1f, 0f, 0f, 1f, 1f, 1f)
            vertexBuf = ByteBuffer.allocateDirect(verts.size * 4).order(ByteOrder.nativeOrder()).asFloatBuffer().put(verts).apply { position(0) }
            uvBuf = ByteBuffer.allocateDirect(uvs.size * 4).order(ByteOrder.nativeOrder()).asFloatBuffer().put(uvs).apply { position(0) }

            GLES20.glGenTextures(1, texIds, 0)
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, texIds[0])
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
            GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, initialBitmap, 0)

            uTimeLoc = GLES20.glGetUniformLocation(program, "uTime")
            uEnvLoc = GLES20.glGetUniformLocation(program, "uEnvType")
            uZoomLoc = GLES20.glGetUniformLocation(program, "uZoom")
            uPanLoc = GLES20.glGetUniformLocation(program, "uPan")
            uAudioLoc = GLES20.glGetUniformLocation(program, "uAudio")
            uTexLoc = GLES20.glGetUniformLocation(program, "uOverlayTex")
        }

        fun draw(timeSec: Float, envType: Float, zoom: Float, pan: Float, audioEnergy: Float, overlay: Bitmap, isFirstFrame: Boolean) {
            GLES20.glViewport(0, 0, width, height)
            GLES20.glUseProgram(program)

            val posLoc = GLES20.glGetAttribLocation(program, "aPos")
            val uvLoc = GLES20.glGetAttribLocation(program, "aUv")
            GLES20.glEnableVertexAttribArray(posLoc)
            GLES20.glVertexAttribPointer(posLoc, 2, GLES20.GL_FLOAT, false, 0, vertexBuf)
            GLES20.glEnableVertexAttribArray(uvLoc)
            GLES20.glVertexAttribPointer(uvLoc, 2, GLES20.GL_FLOAT, false, 0, uvBuf)

            GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, texIds[0])
            if (!isFirstFrame) GLUtils.texSubImage2D(GLES20.GL_TEXTURE_2D, 0, 0, 0, overlay)
            GLES20.glUniform1i(uTexLoc, 0)

            GLES20.glUniform1f(uTimeLoc, timeSec)
            GLES20.glUniform1f(uEnvLoc, envType)
            GLES20.glUniform1f(uZoomLoc, zoom)
            GLES20.glUniform1f(uPanLoc, pan)
            GLES20.glUniform1f(uAudioLoc, audioEnergy)

            GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
        }

        fun release() {
            GLES20.glDeleteTextures(1, texIds, 0)
            GLES20.glDeleteProgram(program)
        }

        private fun compile(type: Int, src: String): Int {
            val s = GLES20.glCreateShader(type)
            GLES20.glShaderSource(s, src)
            GLES20.glCompileShader(s)
            return s
        }
    }
}
`,
  },
  {
    path: 'app/src/main/java/com/bharatai/pocketengine/graphics/FilamentAvatarRenderer.kt',
    language: 'kotlin',
    description: 'Google Filament 60 FPS Android glTF/GLB renderer with Animator.applyCrossFade and facial lip-sync morph weights',
    content: `package com.bharatai.pocketengine.graphics

import android.content.Context
import android.net.Uri
import android.opengl.Matrix
import android.view.Choreographer
import android.view.Surface
import android.view.SurfaceView
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import com.bharatai.pocketengine.model.GestureAction
import com.google.android.filament.*
import com.google.android.filament.android.UiHelper
import com.google.android.filament.gltfio.Animator
import com.google.android.filament.gltfio.AssetLoader
import com.google.android.filament.gltfio.FilamentAsset
import com.google.android.filament.gltfio.Gltfio
import com.google.android.filament.gltfio.ResourceLoader
import com.google.android.filament.gltfio.UbershaderProvider
import com.google.android.filament.utils.Utils
import java.nio.ByteBuffer
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.sin

class FilamentAvatarController(
    private val context: Context,
    private val surfaceView: SurfaceView
) : Choreographer.FrameCallback, UiHelper.RendererCallback {

    companion object {
        private const val CROSS_FADE_DURATION_SEC = 0.35f
        private var nativeInitialized = false

        @Synchronized
        fun ensureFilamentInitialized() {
            if (!nativeInitialized) {
                Filament.init()
                Gltfio.init()
                Utils.init()
                nativeInitialized = true
            }
        }
    }

    init {
        ensureFilamentInitialized()
    }

    private val engine: Engine = Engine.create()
    private val renderer: Renderer = engine.createRenderer()
    private val scene: Scene = engine.createScene()
    private val view: View = engine.createView().apply {
        this.scene = this@FilamentAvatarController.scene
    }
    private val cameraEntity: Int = EntityManager.get().create()
    private val camera: Camera = engine.createCamera(cameraEntity).apply {
        setExposure(16f, 1f / 125f, 100f)
    }

    private val materialProvider = UbershaderProvider(engine)
    private val assetLoader = AssetLoader(engine, materialProvider, EntityManager.get())
    private val resourceLoader = ResourceLoader(engine)
    private val uiHelper = UiHelper(UiHelper.ContextErrorPolicy.DONT_CHECK)

    private var swapChain: SwapChain? = null
    private var currentAsset: FilamentAsset? = null
    private var currentAnimator: Animator? = null
    private var loadedUri: String? = null

    private var idleClipIndex = -1
    private var talkClipIndex = -1
    private var walkClipIndex = -1
    private var heroClipIndex = -1

    private var activeClipIndex = -1
    private var prevClipIndex = -1
    private var activeAnimTimeSec = 0f
    private var prevAnimTimeSec = 0f
    private var crossFadeElapsedSec = CROSS_FADE_DURATION_SEC

    private var targetGesture: GestureAction = GestureAction.THINKING
    private var targetAudioAmp: Float = 0f
    private var smoothedAudioAmp: Float = 0f
    private var lastFrameNanos: Long = 0L
    private var totalElapsedSec: Float = 0f
    private var isRunning = false

    private val keyLightEntity: Int = EntityManager.get().create()
    private val rimLightEntity: Int = EntityManager.get().create()
    private val indirectLight: IndirectLight

    private val morphEntities = mutableListOf<Pair<Int, Map<String, Int>>>()
    private var spineBoneEntity: Int = 0
    private var headBoneEntity: Int = 0
    private val spineRestMatrix = FloatArray(16)
    private val headRestMatrix = FloatArray(16)
    private val tempMatrix = FloatArray(16)

    init {
        view.camera = camera
        renderer.clearOptions = renderer.clearOptions.apply {
            clear = true
            clearColor = floatArrayOf(0.035f, 0.055f, 0.095f, 1.0f)
        }

        // Balanced 3-point Filament PBR lighting + Spherical Harmonics IndirectLight
        val irradianceSh = floatArrayOf(
            0.55f, 0.62f, 0.72f,
            0.06f, 0.08f, 0.10f,
            0.08f, 0.07f, 0.05f,
            -0.02f, -0.02f, -0.01f,
            0f, 0f, 0f,
            0f, 0f, 0f,
            0f, 0f, 0f,
            0f, 0f, 0f,
            0f, 0f, 0f
        )
        indirectLight = IndirectLight.Builder()
            .irradiance(3, irradianceSh)
            .intensity(24_000f)
            .build(engine)
        scene.indirectLight = indirectLight

        LightManager.Builder(LightManager.Type.DIRECTIONAL)
            .color(1.0f, 0.96f, 0.90f)
            .intensity(75_000f)
            .direction(-0.45f, -0.55f, -0.70f)
            .castShadows(true)
            .build(engine, keyLightEntity)
        scene.addEntity(keyLightEntity)

        LightManager.Builder(LightManager.Type.DIRECTIONAL)
            .color(0.28f, 0.78f, 1.0f)
            .intensity(32_000f)
            .direction(0.60f, -0.25f, 0.72f)
            .build(engine, rimLightEntity)
        scene.addEntity(rimLightEntity)

        uiHelper.renderCallback = this
        uiHelper.attachTo(surfaceView)
    }

    fun start() {
        if (!isRunning) {
            isRunning = true
            lastFrameNanos = 0L
            Choreographer.getInstance().postFrameCallback(this)
        }
    }

    fun stop() {
        isRunning = false
        Choreographer.getInstance().removeFrameCallback(this)
    }

    fun setState(gesture: GestureAction, audioAmp: Float) {
        if (gesture != targetGesture) {
            val nextClip = resolveClipForGesture(gesture)
            if (nextClip >= 0 && nextClip != activeClipIndex) {
                prevClipIndex = activeClipIndex
                prevAnimTimeSec = activeAnimTimeSec
                activeClipIndex = nextClip
                activeAnimTimeSec = 0f
                crossFadeElapsedSec = 0f
            }
            targetGesture = gesture
        }
        targetAudioAmp = audioAmp.coerceIn(0f, 1f)
    }

    fun loadGlb(uriString: String?) {
        if (uriString.isNullOrBlank() || uriString == loadedUri) return
        val bytes = readGlbBytes(uriString) ?: return
        unloadCurrentAsset()

        val buffer = ByteBuffer.allocateDirect(bytes.size).apply {
            put(bytes)
            rewind()
        }
        val asset = assetLoader.createAsset(buffer) ?: return
        resourceLoader.loadResources(asset)
        asset.releaseSourceData()
        scene.addEntities(asset.entities)

        normalizeAssetTransform(asset)
        val animator = asset.instance.animator
        indexClipsAndMorphs(asset, animator)

        currentAsset = asset
        currentAnimator = animator
        loadedUri = uriString
        activeClipIndex = resolveClipForGesture(targetGesture)
        prevClipIndex = idleClipIndex
        activeAnimTimeSec = 0f
        prevAnimTimeSec = 0f
        crossFadeElapsedSec = CROSS_FADE_DURATION_SEC
    }

    private fun readGlbBytes(uriString: String): ByteArray? = runCatching {
        if (uriString.startsWith("asset:///")) {
            val assetPath = uriString.removePrefix("asset:///")
            context.assets.open(assetPath).use { it.readBytes() }
        } else {
            context.contentResolver.openInputStream(Uri.parse(uriString))?.use { it.readBytes() }
        }
    }.getOrNull()

    private fun normalizeAssetTransform(asset: FilamentAsset) {
        val tm = engine.transformManager
        val box = asset.boundingBox
        val center = box.center
        val half = box.halfExtent
        val height = (half[1] * 2f).coerceAtLeast(0.1f)
        val scale = 1.72f / height
        val minY = center[1] - half[1]

        val m = FloatArray(16)
        Matrix.setIdentityM(m, 0)
        Matrix.scaleM(m, 0, scale, scale, scale)
        Matrix.translateM(m, 0, -center[0], -minY, -center[2])

        val rootInstance = tm.getInstance(asset.root)
        if (rootInstance != 0) tm.setTransform(rootInstance, m)
    }

    private fun indexClipsAndMorphs(asset: FilamentAsset, animator: Animator) {
        idleClipIndex = -1
        talkClipIndex = -1
        walkClipIndex = -1
        heroClipIndex = -1

        for (i in 0 until animator.animationCount) {
            val name = animator.getAnimationName(i).lowercase()
            when {
                idleClipIndex < 0 && (name.contains("idle") || name.contains("breath") || name.contains("stand")) -> idleClipIndex = i
                talkClipIndex < 0 && (name.contains("talk") || name.contains("wave") || name.contains("gesture")) -> talkClipIndex = i
                walkClipIndex < 0 && (name.contains("walk") || name.contains("stride")) -> walkClipIndex = i
                heroClipIndex < 0 && (name.contains("hero") || name.contains("point") || name.contains("raise")) -> heroClipIndex = i
            }
        }
        if (idleClipIndex < 0 && animator.animationCount > 0) idleClipIndex = 0
        if (talkClipIndex < 0) talkClipIndex = idleClipIndex
        if (walkClipIndex < 0) walkClipIndex = idleClipIndex
        if (heroClipIndex < 0) heroClipIndex = talkClipIndex

        morphEntities.clear()
        val rm = engine.renderableManager
        val tm = engine.transformManager
        spineBoneEntity = 0
        headBoneEntity = 0

        for (entity in asset.entities) {
            val morphNames = asset.getMorphTargetNames(entity)
            if (morphNames.isNotEmpty() && rm.hasComponent(entity)) {
                val map = morphNames.mapIndexed { idx, n -> n.lowercase() to idx }.toMap()
                morphEntities.add(entity to map)
            }
            val nodeName = (asset.getName(entity) ?: "").lowercase()
            if (tm.hasComponent(entity)) {
                val inst = tm.getInstance(entity)
                if (spineBoneEntity == 0 && (nodeName.contains("spine1") || nodeName == "spine" || nodeName == "chest")) {
                    spineBoneEntity = entity
                    tm.getTransform(inst, spineRestMatrix)
                } else if (headBoneEntity == 0 && nodeName == "head") {
                    headBoneEntity = entity
                    tm.getTransform(inst, headRestMatrix)
                }
            }
        }
    }

    private fun resolveClipForGesture(gesture: GestureAction): Int = when (gesture) {
        GestureAction.WALKING -> walkClipIndex
        GestureAction.TALK_WAVE -> talkClipIndex
        GestureAction.HERO_RAISE, GestureAction.POINTING -> heroClipIndex
        GestureAction.THINKING -> idleClipIndex
    }

    override fun doFrame(frameTimeNanos: Long) {
        if (!isRunning) return
        Choreographer.getInstance().postFrameCallback(this)

        val dt = if (lastFrameNanos == 0L) 1f / 60f else ((frameTimeNanos - lastFrameNanos) / 1_000_000_000.0).toFloat().coerceIn(0.001f, 0.05f)
        lastFrameNanos = frameTimeNanos
        totalElapsedSec += dt

        smoothedAudioAmp += (targetAudioAmp - smoothedAudioAmp) * (1f - exp(-18f * dt))

        val asset = currentAsset
        val animator = currentAnimator
        if (asset != null && animator != null && animator.animationCount > 0) {
            // 1. Advance primary clip + previous clip timers
            if (activeClipIndex >= 0) {
                val dur = animator.getAnimationDuration(activeClipIndex).coerceAtLeast(0.1f)
                activeAnimTimeSec = (activeAnimTimeSec + dt) % dur
                animator.applyAnimation(activeClipIndex, activeAnimTimeSec)
            }

            // 2. Smoothly cross-fade from previous loop (e.g., idle breathing -> talking hand gesture)
            if (crossFadeElapsedSec < CROSS_FADE_DURATION_SEC && prevClipIndex >= 0 && prevClipIndex != activeClipIndex) {
                crossFadeElapsedSec = (crossFadeElapsedSec + dt).coerceAtMost(CROSS_FADE_DURATION_SEC)
                val prevDur = animator.getAnimationDuration(prevClipIndex).coerceAtLeast(0.1f)
                prevAnimTimeSec = (prevAnimTimeSec + dt) % prevDur

                val t = (crossFadeElapsedSec / CROSS_FADE_DURATION_SEC).coerceIn(0f, 1f)
                val smoothAlpha = t * t * (3f - 2f * t)
                animator.applyCrossFade(prevClipIndex, prevAnimTimeSec, 1f - smoothAlpha)
            }

            // 3. Additive idle chest breathing + subtle speaking head nod before bone matrix update
            applyOrganicBreathingAndHeadNod()

            // 4. Push skeletal bone matrices to Filament skinning buffers
            animator.updateBoneMatrices()

            // 5. Drive 60 FPS facial lip-sync & blink morph targets
            applyFacialMorphWeights()
        }

        val sc = swapChain ?: return
        if (renderer.beginFrame(sc, frameTimeNanos)) {
            renderer.render(view)
            renderer.endFrame()
        }
    }

    private fun applyOrganicBreathingAndHeadNod() {
        val tm = engine.transformManager
        if (spineBoneEntity != 0) {
            val inst = tm.getInstance(spineBoneEntity)
            if (inst != 0) {
                val breathPitch = sin(totalElapsedSec * 2.1f) * 1.4f
                Matrix.rotateM(tempMatrix, 0, spineRestMatrix, 0, breathPitch, 1f, 0f, 0f)
                tm.setTransform(inst, tempMatrix)
            }
        }
        if (headBoneEntity != 0) {
            val inst = tm.getInstance(headBoneEntity)
            if (inst != 0) {
                val nodDeg = smoothedAudioAmp * 3.8f * sin(totalElapsedSec * 5.2f)
                val turnDeg = sin(totalElapsedSec * 0.9f) * 2.5f
                Matrix.rotateM(tempMatrix, 0, headRestMatrix, 0, nodDeg, 1f, 0f, 0f)
                Matrix.rotateM(tempMatrix, 0, tempMatrix, 0, turnDeg, 0f, 1f, 0f)
                tm.setTransform(inst, tempMatrix)
            }
        }
    }

    private fun applyFacialMorphWeights() {
        val rm = engine.renderableManager
        val blinkCycle = totalElapsedSec % 3.6f
        val blink = if (blinkCycle > 3.44f) sin(((blinkCycle - 3.44f) / 0.16f) * PI).toFloat() else 0f
        val jaw = (smoothedAudioAmp * 0.95f).coerceIn(0f, 1f)
        val smile = (0.14f + smoothedAudioAmp * 0.18f).coerceIn(0f, 1f)
        val brow = (smoothedAudioAmp * 0.45f).coerceIn(0f, 1f)

        for ((entity, dict) in morphEntities) {
            val inst = rm.getInstance(entity)
            if (inst == 0) continue
            val weights = FloatArray(dict.size)
            dict.forEach { (name, idx) ->
                weights[idx] = when {
                    name.contains("jawopen") || name.contains("mouthopen") || name.contains("viseme_aa") -> jaw
                    name.contains("smile") -> smile
                    name.contains("blink") || name.contains("eyesclosed") -> blink
                    name.contains("brow") -> brow
                    else -> 0f
                }
            }
            rm.setMorphWeights(inst, weights, 0)
        }
    }

    override fun onNativeWindowChanged(surface: Surface) {
        swapChain?.let { engine.destroySwapChain(it) }
        swapChain = engine.createSwapChain(surface)
        start()
    }

    override fun onDetachedFromSurface() {
        stop()
        swapChain?.let {
            engine.destroySwapChain(it)
            engine.flushAndWait()
            swapChain = null
        }
    }

    override fun onResized(width: Int, height: Int) {
        view.viewport = Viewport(0, 0, width, height)
        val aspect = width.toDouble() / height.coerceAtLeast(1).toDouble()
        camera.setProjection(36.0, aspect, 0.1, 40.0, Camera.Fov.VERTICAL)
        camera.lookAt(0.0, 1.18, 2.35, 0.0, 1.05, 0.0, 0.0, 1.0, 0.0)
    }

    private fun unloadCurrentAsset() {
        currentAsset?.let { asset ->
            scene.removeEntities(asset.entities)
            assetLoader.destroyAsset(asset)
        }
        currentAsset = null
        currentAnimator = null
        morphEntities.clear()
        loadedUri = null
    }

    fun destroy() {
        stop()
        uiHelper.detach()
        unloadCurrentAsset()
        resourceLoader.destroy()
        assetLoader.destroy()
        materialProvider.destroyMaterials()
        materialProvider.destroy()
        engine.destroyEntity(keyLightEntity)
        engine.destroyEntity(rimLightEntity)
        engine.destroyIndirectLight(indirectLight)
        engine.destroyRenderer(renderer)
        engine.destroyView(view)
        engine.destroyScene(scene)
        engine.destroyCameraComponent(cameraEntity)
        EntityManager.get().destroy(keyLightEntity)
        EntityManager.get().destroy(rimLightEntity)
        EntityManager.get().destroy(cameraEntity)
        engine.destroy()
    }
}

@Composable
fun FilamentAvatarStageView(
    glbModelUri: String?,
    gesture: GestureAction,
    audioAmp: Float,
    modifier: Modifier = Modifier
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val surfaceView = remember { SurfaceView(context) }
    val controller = remember(surfaceView) { FilamentAvatarController(context, surfaceView) }

    LaunchedEffect(glbModelUri) {
        controller.loadGlb(glbModelUri)
    }

    LaunchedEffect(gesture, audioAmp) {
        controller.setState(gesture, audioAmp)
    }

    DisposableEffect(controller) {
        onDispose { controller.destroy() }
    }

    AndroidView(factory = { surfaceView }, modifier = modifier)
}
`,
  },
  {
    path: 'app/src/main/java/com/bharatai/pocketengine/media/FinalMovieMuxer.kt',
    language: 'kotlin',
    description: 'Media3 Transformer muxing hardware H.264 video with mixed AAC audio',
    content: `package com.bharatai.pocketengine.media

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.transformer.*
import kotlinx.coroutines.suspendCancellableCoroutine
import java.io.File
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class FinalMovieMuxer(private val context: Context) {

    @OptIn(UnstableApi::class)
    suspend fun muxVideoAndAudio(
        videoOnlyMp4: File,
        mixedAudioWav: File,
        finalOutputMp4: File,
        onProgress: (Int) -> Unit
    ): File = suspendCancellableCoroutine { cont ->
        if (finalOutputMp4.exists()) finalOutputMp4.delete()

        val videoItem = EditedMediaItem.Builder(MediaItem.fromUri(Uri.fromFile(videoOnlyMp4)))
            .setRemoveAudio(true)
            .build()
        val audioItem = EditedMediaItem.Builder(MediaItem.fromUri(Uri.fromFile(mixedAudioWav)))
            .setRemoveVideo(true)
            .build()

        val composition = Composition.Builder(
            listOf(
                EditedMediaItemSequence.withVideoFrom(listOf(videoItem)),
                EditedMediaItemSequence.withAudioFrom(listOf(audioItem))
            )
        ).build()

        val handler = Handler(Looper.getMainLooper())
        val holder = ProgressHolder()

        handler.post {
            lateinit var transformer: Transformer
            val tick = object : Runnable {
                override fun run() {
                    if (transformer.getProgress(holder) == Transformer.PROGRESS_STATE_AVAILABLE) {
                        onProgress(85 + (holder.progress * 15) / 100)
                    }
                    if (cont.isActive) handler.postDelayed(this, 200L)
                }
            }

            transformer = Transformer.Builder(context)
                .setVideoMimeType(MimeTypes.VIDEO_H264)
                .setAudioMimeType(MimeTypes.AUDIO_AAC)
                .addListener(object : Transformer.Listener {
                    override fun onCompleted(composition: Composition, exportResult: ExportResult) {
                        handler.removeCallbacks(tick)
                        onProgress(100)
                        if (cont.isActive) cont.resume(finalOutputMp4)
                    }
                    override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) {
                        handler.removeCallbacks(tick)
                        if (cont.isActive) cont.resumeWithException(exportException)
                    }
                })
                .build()

            transformer.start(composition, finalOutputMp4.absolutePath)
            handler.post(tick)
            cont.invokeOnCancellation {
                handler.post {
                    handler.removeCallbacks(tick)
                    transformer.cancel()
                }
            }
        }
    }
}
`,
  },
  {
    path: 'app/src/main/java/com/bharatai/pocketengine/MainActivity.kt',
    language: 'kotlin',
    description: 'Compose entry activity launching PocketStudioScreen',
    content: `package com.bharatai.pocketengine

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.bharatai.pocketengine.ui.PocketStudioScreen

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent { PocketStudioScreen() }
    }
}
`,
  },
  {
    path: 'app/src/main/java/com/bharatai/pocketengine/ui/PocketStudioScreen.kt',
    language: 'kotlin',
    description: 'Material 3 Jetpack Compose studio UI with Create, Actors, and ExoPlayer Export tabs',
    content: `package com.bharatai.pocketengine.ui

import android.Manifest
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.FileProvider
import androidx.media3.common.MediaItem
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import com.bharatai.pocketengine.audio.AudioMixEngine
import com.bharatai.pocketengine.brain.LocalDirectorBrain
import com.bharatai.pocketengine.graphics.FilamentAvatarStageView
import com.bharatai.pocketengine.graphics.GpuSceneRenderer
import com.bharatai.pocketengine.media.FinalMovieMuxer
import com.bharatai.pocketengine.model.*
import kotlinx.coroutines.launch
import java.io.File

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PocketStudioScreen() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    val brain = remember { LocalDirectorBrain() }
    val audioEngine = remember { AudioMixEngine(context) }
    val gpuRenderer = remember { GpuSceneRenderer(context) }
    val muxer = remember { FinalMovieMuxer(context) }

    DisposableEffect(Unit) { onDispose { audioEngine.shutdown() } }

    var tab by remember { mutableIntStateOf(0) }
    var idea by remember {
        mutableStateOf("1987 में राजस्थान के जैसलमेर बॉर्डर पर आसमान से एक रहस्यमयी रोशनी उतरी। अचानक तेज आंधी और आग की चिंगारियां फैल गईं। अब अर्जुन इस अनसुलझे रहस्य का सच खोजने निकल पड़ा है!")
    }
    var language by remember { mutableStateOf(VoiceLang.HINDI) }
    var aspect by remember { mutableStateOf(AspectFormat.REEL_9_16) }

    var cast by remember {
        mutableStateOf(
            listOf(
                ActorProfile(name = "Arjun", isFemale = false, accentColor = 0xFF00D4FF.toInt(), robeColor = 0xFF1B3B6F.toInt()),
                ActorProfile(name = "Meera", isFemale = true, accentColor = 0xFFFF7B00.toInt(), robeColor = 0xFF5A189A.toInt())
            )
        )
    }

    var scenes by remember { mutableStateOf<List<DirectedScene>>(emptyList()) }
    var progressPct by remember { mutableIntStateOf(0) }
    var statusText by remember { mutableStateOf("Ready • 100% On-Device GPU & CPU Engine") }
    var isRunning by remember { mutableStateOf(false) }
    var finalMp4 by remember { mutableStateOf<File?>(null) }

    val micLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        if (ok) {
            captureSpeech(context, language) { spoken, err ->
                if (!spoken.isNullOrBlank()) idea = if (idea.isBlank()) spoken else "$idea $spoken"
                else if (err != null) Toast.makeText(context, err, Toast.LENGTH_SHORT).show()
            }
        }
    }

    fun runOneClickPhoneProduction() {
        if (isRunning) return
        scope.launch {
            isRunning = true
            progressPct = 2
            finalMp4 = null
            try {
                val workDir = File(context.cacheDir, "pocket_render").apply { deleteRecursively(); mkdirs() }
                statusText = "1/4 • Analyzing Story & Choreography..."
                val planned = brain.directStory(idea, language, cast)

                val voiced = mutableListOf<DirectedScene>()
                for ((i, s) in planned.withIndex()) {
                    statusText = "2/4 • Synthesizing Voice & Lip-Sync (\${i + 1}/\${planned.size})..."
                    val wavFile = File(workDir, "tts_\${s.index}.wav")
                    val (cleanWav, durMs, env) = audioEngine.synthesizeSceneAndExtractLipSync(s, language, wavFile)
                    voiced.add(s.copy(audioWavPath = cleanWav.absolutePath, durationMs = durMs, lipSyncEnvelope = env))
                    progressPct = 5 + ((i + 1) * 15) / planned.size
                }
                scenes = voiced

                statusText = "3/4 • Mixing Procedural BGM & Environment SFX in RAM..."
                val mixedAudio = audioEngine.mixMasterMovieAudio(voiced, File(workDir, "master_audio.wav"))

                statusText = "4/4 • Phone GPU Rendering \${aspect.label} at 30 FPS..."
                val rawVideo = gpuRenderer.renderGpuVideoOnly(voiced, aspect, File(workDir, "gpu_video.mp4")) { pct ->
                    progressPct = 20 + (pct * 65) / 100
                }

                statusText = "Finalizing MP4 Movie..."
                val outFile = File(context.cacheDir, "BharatAI_Pocket_\${System.currentTimeMillis()}.mp4")
                finalMp4 = muxer.muxVideoAndAudio(rawVideo, mixedAudio, outFile) { pct -> progressPct = pct }
                statusText = "Done! Rendered completely on your phone."
                tab = 2
            } catch (e: Exception) {
                statusText = "Failed: \${e.message}"
                Toast.makeText(context, e.message ?: "Error", Toast.LENGTH_LONG).show()
            } finally {
                isRunning = false
            }
        }
    }

    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Color(0xFF00D4FF),
            secondary = Color(0xFFFF7B00),
            background = Color(0xFF070B12),
            surface = Color(0xFF101826)
        )
    ) {
        Scaffold(
            topBar = {
                TopAppBar(
                    title = {
                        Column {
                            Text("Bharat-AI Pocket Engine", fontWeight = FontWeight.Bold)
                            Text(statusText, style = MaterialTheme.typography.labelSmall, color = Color(0xFF00D4FF))
                        }
                    }
                )
            },
            bottomBar = {
                NavigationBar {
                    NavigationBarItem(selected = tab == 0, onClick = { tab = 0 }, icon = { Icon(Icons.Default.AutoAwesome, null) }, label = { Text("Create") })
                    NavigationBarItem(selected = tab == 1, onClick = { tab = 1 }, icon = { Icon(Icons.Default.Face, null) }, label = { Text("Actors") })
                    NavigationBarItem(selected = tab == 2, onClick = { tab = 2 }, icon = { Icon(Icons.Default.Movie, null) }, label = { Text("Export") })
                }
            }
        ) { pad ->
            Box(Modifier.fillMaxSize().padding(pad).background(MaterialTheme.colorScheme.background)) {
                when (tab) {
                    0 -> LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        item {
                            OutlinedTextField(
                                value = idea,
                                onValueChange = { idea = it },
                                label = { Text("Enter Story Idea (Hindi / English)") },
                                modifier = Modifier.fillMaxWidth().heightIn(min = 140.dp)
                            )
                        }
                        item {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                VoiceLang.entries.forEach { l ->
                                    FilterChip(selected = language == l, onClick = { language = l }, label = { Text(l.label) })
                                }
                            }
                        }
                        item {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                AspectFormat.entries.forEach { f ->
                                    FilterChip(selected = aspect == f, onClick = { aspect = f }, label = { Text(f.label) })
                                }
                            }
                        }
                        item {
                            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                                OutlinedButton(onClick = { micLauncher.launch(Manifest.permission.RECORD_AUDIO) }, modifier = Modifier.weight(1f)) {
                                    Icon(Icons.Default.Mic, null); Spacer(Modifier.width(6.dp)); Text("Speak")
                                }
                                Button(onClick = { runOneClickPhoneProduction() }, enabled = !isRunning, modifier = Modifier.weight(1.5f)) {
                                    Icon(Icons.Default.PlayArrow, null); Spacer(Modifier.width(6.dp))
                                    Text(if (isRunning) "Rendering $progressPct%" else "Generate on Phone")
                                }
                            }
                        }
                        if (isRunning) {
                            item { LinearProgressIndicator(progress = { progressPct / 100f }, modifier = Modifier.fillMaxWidth()) }
                        }
                        val previewActor = scenes.firstOrNull()?.actor ?: cast.firstOrNull()
                        if (previewActor?.glbModelUri != null) {
                            item {
                                val previewScene = scenes.firstOrNull()
                                FilamentAvatarStageView(
                                    glbModelUri = previewActor.glbModelUri,
                                    gesture = previewScene?.gesture ?: GestureAction.TALK_WAVE,
                                    audioAmp = if (isRunning) 0.65f else 0.12f,
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .height(260.dp)
                                        .clip(RoundedCornerShape(12.dp))
                                )
                            }
                        }
                        items(scenes) { s ->
                            Card(Modifier.fillMaxWidth()) {
                                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Text("Scene \${s.index} • \${s.locationTitle} (\${s.durationMs / 1000.0}s)", fontWeight = FontWeight.Bold, color = Color(0xFF00D4FF))
                                    Text("\${s.actor.name} [\${s.gesture.label}]: \\"\${s.dialogue}\\"")
                                    Text("Biome: \${s.biome.label} • Mood: \${s.emotion.label}", style = MaterialTheme.typography.labelSmall)
                                }
                            }
                        }
                    }

                    1 -> ActorTab(cast = cast, onChange = { cast = it }, onTest = { a -> scope.launch { audioEngine.speakPreview("नमस्ते, मैं \${a.name} हूँ।", a, language) } })

                    2 -> ExportTab(
                        mp4 = finalMp4,
                        onSave = { saveToMovies(context, it) },
                        onShare = { shareFile(context, it) }
                    )
                }
            }
        }
    }
}

@Composable
private fun ActorTab(cast: List<ActorProfile>, onChange: (List<ActorProfile>) -> Unit, onTest: (ActorProfile) -> Unit) {
    var pickingId by remember { mutableStateOf<String?>(null) }
    var pickingGlbId by remember { mutableStateOf<String?>(null) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        val id = pickingId
        if (uri != null && id != null) onChange(cast.map { if (it.id == id) it.copy(portraitUri = uri.toString()) else it })
    }
    val glbPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        val id = pickingGlbId
        if (uri != null && id != null) onChange(cast.map { if (it.id == id) it.copy(glbModelUri = uri.toString()) else it })
    }
    LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        items(cast, key = { it.id }) { actor ->
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                        Text(actor.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                        IconButton(onClick = { onTest(actor) }) { Icon(Icons.Default.VolumeUp, null) }
                    }
                    Text("Voice Pitch: \${"%.2f".format(actor.pitch)}", style = MaterialTheme.typography.labelSmall)
                    Slider(value = actor.pitch, onValueChange = { p -> onChange(cast.map { if (it.id == actor.id) it.copy(pitch = p) else it }) }, valueRange = 0.7f..1.45f)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                        OutlinedButton(onClick = { pickingId = actor.id; picker.launch("image/*") }, modifier = Modifier.weight(1f)) {
                            Icon(Icons.Default.Image, null); Spacer(Modifier.width(6.dp))
                            Text(if (actor.portraitUri == null) "Face Photo" else "Change Face")
                        }
                        OutlinedButton(onClick = { pickingGlbId = actor.id; glbPicker.launch(arrayOf("model/gltf-binary", "application/octet-stream", "*/*")) }, modifier = Modifier.weight(1f)) {
                            Icon(Icons.Default.ViewInAr, null); Spacer(Modifier.width(6.dp))
                            Text(if (actor.glbModelUri == null) "Attach .glb" else "3D .glb Ready")
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ExportTab(mp4: File?, onSave: (File) -> Unit, onShare: (File) -> Unit) {
    val context = LocalContext.current
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (mp4 != null && mp4.exists()) {
            val player = remember(mp4.absolutePath) {
                ExoPlayer.Builder(context).build().apply {
                    setMediaItem(MediaItem.fromUri(Uri.fromFile(mp4)))
                    prepare()
                }
            }
            DisposableEffect(player) { onDispose { player.release() } }
            AndroidView(
                factory = { ctx -> PlayerView(ctx).apply { this.player = player; useController = true } },
                modifier = Modifier.fillMaxWidth().height(340.dp).clip(RoundedCornerShape(12.dp)).background(Color.Black)
            )
            Text("Size: \${mp4.length() / 1024} KB (H.264 + AAC)", color = Color(0xFF00D4FF))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                Button(onClick = { onSave(mp4) }, modifier = Modifier.weight(1f)) { Text("Save to Movies") }
                OutlinedButton(onClick = { onShare(mp4) }, modifier = Modifier.weight(1f)) { Text("Share MP4") }
            }
        } else {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("Tap 'Generate on Phone' on the Create tab to render your GPU video.")
            }
        }
    }
}

private fun captureSpeech(context: Context, lang: VoiceLang, cb: (String?, String?) -> Unit) {
    if (!SpeechRecognizer.isRecognitionAvailable(context)) {
        cb(null, "Speech recognition unavailable.")
        return
    }
    val rec = SpeechRecognizer.createSpeechRecognizer(context)
    val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang.tag)
    }
    rec.setRecognitionListener(object : RecognitionListener {
        override fun onReadyForSpeech(p0: Bundle?) {}
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(p0: Float) {}
        override fun onBufferReceived(p0: ByteArray?) {}
        override fun onEndOfSpeech() {}
        override fun onPartialResults(p0: Bundle?) {}
        override fun onEvent(p0: Int, p1: Bundle?) {}
        override fun onError(err: Int) { rec.destroy(); cb(null, "Mic error $err") }
        override fun onResults(res: Bundle?) {
            val text = res?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
            rec.destroy(); cb(text, null)
        }
    })
    rec.startListening(intent)
}

private fun saveToMovies(context: Context, file: File) {
    runCatching {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(MediaStore.Video.Media.DISPLAY_NAME, file.name)
                put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
                put(MediaStore.Video.Media.RELATIVE_PATH, "\${Environment.DIRECTORY_MOVIES}/BharatAI")
                put(MediaStore.Video.Media.IS_PENDING, 1)
            }
            val uri = context.contentResolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values)!!
            context.contentResolver.openOutputStream(uri)?.use { out -> file.inputStream().use { it.copyTo(out) } }
            values.clear(); values.put(MediaStore.Video.Media.IS_PENDING, 0)
            context.contentResolver.update(uri, values, null, null)
        } else {
            val dest = File(context.getExternalFilesDir(Environment.DIRECTORY_MOVIES) ?: context.filesDir, file.name)
            file.copyTo(dest, overwrite = true)
        }
        Toast.makeText(context, "Saved to Movies/BharatAI!", Toast.LENGTH_LONG).show()
    }.onFailure { Toast.makeText(context, "Save failed: \${it.message}", Toast.LENGTH_LONG).show() }
}

private fun shareFile(context: Context, file: File) {
    runCatching {
        val uri = FileProvider.getUriForFile(context, "\${context.packageName}.fileprovider", file)
        val i = Intent(Intent.ACTION_SEND).apply {
            type = "video/mp4"
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(Intent.createChooser(i, "Share Bharat-AI Video"))
    }
}
`,
  },
];

// Minimal CRC32 + Uncompressed ZIP generator for zero-dependency project download
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function createAndroidProjectZipBlob(): Blob {
  const encoder = new TextEncoder();
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;

  for (const file of ANDROID_PROJECT_FILES) {
    const nameBytes = encoder.encode(`bharat-ai-pocket-engine/${file.path}`);
    const dataBytes = encoder.encode(file.content);
    const crc = crc32(dataBytes);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, dataBytes.length, true);
    lv.setUint32(22, dataBytes.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, dataBytes.length, true);
    cv.setUint32(24, dataBytes.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);

    localChunks.push(localHeader, dataBytes);
    centralChunks.push(centralHeader);
    offset += localHeader.length + dataBytes.length;
  }

  const centralSize = centralChunks.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, ANDROID_PROJECT_FILES.length, true);
  ev.setUint16(10, ANDROID_PROJECT_FILES.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  return new Blob([...localChunks, ...centralChunks, eocd] as BlobPart[], {
    type: 'application/zip',
  });
}
