/** \file OSCVOL_Pro.cxx
*   Remote Fader & Metering System - Pro Version (Final API Fixed)
*/

// --- PREMIUM SKIN DEFINITION (Embedded) ---
string customSkin = 
"<SKIN font_face='Arial' font_size='12' text_color='#e2e8f0' background_color='#0f172a'>" +
"  <COLUMN spacing='15' padding='20' width='240' background_color='#1e293b' border_color='#334155' border_width='2' corner_radius='8'>" +
"    <TEXT value='REMOTE MIXER PRO' font_size='18' font_weight='bold' text_color='#3b82f6' margin_bottom='5' />" +
"    <COLUMN spacing='5' h_align='center' padding='10' background_color='#0f172a' corner_radius='4' width='100%'>" +
"      <TEXT value='SOURCE TRACK ID' font_size='10' text_color='#94a3b8' font_weight='bold' />" +
"      <PARAM_TEXT_CONTROL param_id='input0' width='100' height='30' font_size='16' font_weight='bold' />" +
"    </COLUMN>" +
"    <ROW spacing='20' h_align='center' v_align='top' padding='10' height='350'>" +
"      <COLUMN spacing='10' h_align='center'>" +
"        <TEXT value='GAIN' font_size='10' text_color='#94a3b8' />" +
"        <LAYER width='60' height='240' background_color='#0f172a' corner_radius='5' border_color='#334155' border_width='1'>" +
"          <RECT width='4' height='220' color='#334155' h_align='center' v_align='center' />" +
"          <PARAM_SLIDER param_id='input1' width='60' height='240' orientation='vertical' />" +
"        </LAYER>" +
"        <PARAM_TEXT_CONTROL param_id='input1' width='80' height='25' />" +
"      </COLUMN>" +
"      <COLUMN spacing='10' h_align='center'>" +
"        <TEXT value='PEAK' font_size='10' text_color='#94a3b8' />" +
"        <LAYER width='30' height='240' background_color='#000000' border_color='#334155' border_width='1'>" +
"           <PARAM_SLIDER param_id='output0' width='30' height='240' orientation='vertical' readonly='true' />" +
"        </LAYER>" +
"        <PARAM_TEXT_CONTROL param_id='output0' width='80' height='25' readonly='true' text_color='#10b981' />" +
"      </COLUMN>" +
"    </ROW>" +
"    <COLUMN padding='5' h_align='center' background_color='#0f172a' width='100%'>" +
"       <TEXT value='ENGINE CONNECTED' font_size='9' text_color='#10b981' font_weight='bold' />" +
"    </COLUMN>" +
"  </COLUMN>" +
"</SKIN>";

string name = "Remote Gain & Meter Pro";
string description = "Professional Audio Processing Engine with Unified UI.";

array<string> inputParametersNames = {"Track ID", "Gain Level"};
array<double> inputParameters(2);
array<double> inputParametersMin = {0, 0};
array<double> inputParametersMax = {16, 1};
array<double> inputParametersDefault = {0, 0.75};
array<int> inputParametersSteps = {17, 0};

array<string> outputParametersNames = {"Peak dB"};
array<double> outputParameters(1);
array<double> outputParametersMin = {-60};
array<double> outputParametersMax = {0};

double smoothingGain = 0.75;
const double kSmoothingCoeff = 0.995;

void setup(double sampleRate) {
    smoothingGain = inputParameters[1];
}

void processBlock(BlockData& data) {
    double targetGain = inputParameters[1];
    double maxPeak = 0.0;
    
    uint chCount = data.samples.length; // Use property instead of function call
    for (uint ch = 0; ch < chCount; ++ch) {
        array<double>@ channelBuffer = data.samples[ch];
        for (uint i = 0; i < data.samplesToProcess; ++i) {
            smoothingGain = smoothingGain * kSmoothingCoeff + targetGain * (1.0 - kSmoothingCoeff);
            double smp = channelBuffer[i] * smoothingGain;
            channelBuffer[i] = smp;
            double absSmp = (smp < 0) ? -smp : smp;
            if (absSmp > maxPeak) maxPeak = absSmp;
        }
    }
    double leveldB = -60.0;
    if (maxPeak > 0.001) {
        leveldB = 20.0 * log10(maxPeak);
        if (leveldB < -60.0) leveldB = -60.0;
        if (leveldB > 0.0) leveldB = 0.0;
    }
    outputParameters[0] = leveldB;
}
