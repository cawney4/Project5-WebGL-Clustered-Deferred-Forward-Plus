export default function(params) {
  return `
  #version 100
  precision highp float;
  
  uniform sampler2D u_gbuffers[${params.numGBuffers}];
  

  #define M_PI 3.141592653

  uniform sampler2D u_colmap;
  uniform sampler2D u_normap;
  uniform sampler2D u_lightbuffer;
  uniform int u_xSlices;
  uniform int u_ySlices;
  uniform int u_xDim;
  uniform int u_yDim;
  uniform float u_dZ;
  uniform float u_camNear;
  uniform int u_texWidth;
  uniform int u_texHeight;

  
  uniform mat4 u_viewMatrix;
  uniform int u_clusterDimX;
  uniform int u_clusterDimY;

  // TODO: Read this buffer to determine the lights influencing a cluster
  uniform sampler2D u_clusterbuffer;
  
  
  
  varying vec2 v_uv;
  
  struct Light {
    vec3 position;
    float radius;
    vec3 color;
  };

  float ExtractFloat(sampler2D texture, int textureWidth, int textureHeight, int index, int component) {
    float u = float(index + 1) / float(textureWidth + 1);
    int pixel = component / 4;
    float v = float(pixel + 1) / float(textureHeight + 1);
    vec4 texel = texture2D(texture, vec2(u, v));
    int pixelComponent = component - (pixel * 4);
    if (pixelComponent == 0) {
      return texel[0];
    } else if (pixelComponent == 1) {
      return texel[1];
    } else if (pixelComponent == 2) {
      return texel[2];
    } else if (pixelComponent == 3) {
      return texel[3];
    }
    return 0.0;
  }

  Light UnpackLight(int index) {
    Light light;
    float u = float(index + 1) / float(${params.numLights + 1});
    vec4 v1 = texture2D(u_lightbuffer, vec2(u, 0.3));
    vec4 v2 = texture2D(u_lightbuffer, vec2(u, 0.6));
    light.position = v1.xyz;

    // LOOK: This extracts the 4th float (radius) of the (index)th light in the buffer
    // Note that this is just an example implementation to extract one float.
    // There are more efficient ways if you need adjacent values
    light.radius = ExtractFloat(u_lightbuffer, ${params.numLights}, 2, index, 3);

    light.color = v2.rgb;
    return light;
  }

  // Cubic approximation of gaussian curve so we falloff to exactly 0 at the light radius
  float cubicGaussian(float h) {
    if (h < 1.0) {
      return 0.25 * pow(2.0 - h, 3.0) - pow(1.0 - h, 3.0);
    } else if (h < 2.0) {
      return 0.25 * pow(2.0 - h, 3.0);
    } else {
      return 0.0;
    }
  }
  
  void main() {
    // TODO: extract data from g buffers and do lighting
    vec4 gb0 = texture2D(u_gbuffers[0], v_uv);
    vec4 gb1 = texture2D(u_gbuffers[1], v_uv);
    //vec4 gb2 = texture2D(u_gbuffers[2], v_uv);
    
    
    vec3 albedo = gb1.rgb;
    vec3 v_position = gb0.xyz;
    //vec3 normal = gb2.xyz;
    
    // Optimization. 2-component normal
    vec3 normal = vec3(gb0.w, gb1.w, 0.0);
    normal.z = sqrt(1.0 - (normal.x * normal.x) - (normal.y * normal.y));
    normal = normalize(normal);

    // Convert v_position from world to camera space
    vec3 c_position = vec3(u_viewMatrix * vec4(v_position, 1.0));
    c_position.z *= -1.0;
    
    int x = int(floor(float(u_xSlices) * gl_FragCoord.x / float(u_xDim)));
    int y = int(floor(float(u_ySlices) * gl_FragCoord.y / float(u_yDim)));
    int z = int((c_position.z - u_camNear) / u_dZ);
    
    int index = x + y * u_xSlices + z * u_xSlices * u_ySlices;
    
    
    float u = float(index + 1) / float(u_clusterDimX + 1);
    float v = 1.0 / float(u_clusterDimY + 1);
    float dV = v;
    
    vec4 data0 = texture2D(u_clusterbuffer, vec2(u, v));
    int num = int(data0[0]);
    num = int(ExtractFloat(u_clusterbuffer, u_clusterDimX, u_clusterDimY, index, 0));
    
    vec3 fragColor = vec3(0.0);
    
    vec4 color = data0; 
    for (int i = 1; i <= ${params.maxLights}; i++) {
        
        if (i == num) {
            break;
        }
        
        // Calculate i % 4
        int division = i / 4;
        int mod = i - (division * 4);
        
        int colorIndex = mod;
        
        int lightIndex;
        if (colorIndex == 0) {
            v += dV;
            color = texture2D(u_clusterbuffer, vec2(u, v));
            
            lightIndex = int(color[0]);
        } else if (colorIndex == 1) {
            lightIndex = int(color[1]);
        } else if (colorIndex == 2) {
            lightIndex = int(color[2]);
        } else {
            lightIndex = int(color[3]);
        }
        
        lightIndex = int(ExtractFloat(u_clusterbuffer, u_clusterDimX, u_clusterDimY, index, i));
        
        Light light = UnpackLight(lightIndex);
        
        float lightDistance = distance(light.position, v_position);
        vec3 L = (light.position - v_position) / lightDistance; 
        float lightIntensity = cubicGaussian(2.0 * lightDistance / light.radius);
        float lambertTerm = max(dot(L, normal), 0.0);
        
        // Toon shading. Ramp
        if (lambertTerm < 0.3) {
            lambertTerm = 0.3;
        } else if (lambertTerm  < 0.6) {
            lambertTerm = 0.6;
        } else {
            lambertTerm = 1.0;
        }
        
        fragColor += albedo * lambertTerm * light.color * vec3(lightIntensity);
        
    }
    
    
    // Toon shading. Edge detection
    
    
    float dX = 1.0 / float(u_texWidth);
    float dY = 1.0 / float(u_texHeight);

    mat3 sobelHorizontal;
    sobelHorizontal[0] = vec3(3.0, 0.0, -3.0);
    sobelHorizontal[1] = vec3(10.0, 0.0, -10.0);
    sobelHorizontal[2] = vec3(3.0, 0.0, -3.0);

    mat3 sobelVertical;
    sobelVertical[0] = vec3(3.0, 10.0, 3.0);
    sobelVertical[1] = vec3(0.0, 0.0, 0.0);
    sobelVertical[2] = vec3(-3.0, -10.0, -3.0);

    vec3 totalHorizontal = vec3(0, 0, 0);
    vec3 totalVertical = vec3(0, 0, 0);

    vec3 tempColor;
    vec2 tempUV;
    for (int i = -1; i <= 1; i++) {
        for (int j = -1; j <= 1; j++) {
            tempUV = clamp(v_uv + vec2(float(i) * dX, float(j) * dY), 0.0, 1.0);
            tempColor = texture2D(u_gbuffers[1], tempUV).rgb;
            totalHorizontal += sobelHorizontal[i + 1][j + 1] * tempColor;
            totalVertical += sobelVertical[i + 1][j + 1] * tempColor;
        }
    }

    float gradientR = sqrt(totalHorizontal.r * totalHorizontal.r + totalVertical.r * totalVertical.r);//  distance(totalHorizontal.r, totalVertical.r);
    float gradientG = sqrt(totalHorizontal.g * totalHorizontal.g + totalVertical.g * totalVertical.g);//  distance(totalHorizontal.g, totalVertical.g);
    float gradientB = sqrt(totalHorizontal.b * totalHorizontal.b + totalVertical.b * totalVertical.b);//  distance(totalHorizontal.b, totalVertical.b);
    tempColor = vec3(gradientR, gradientG, gradientB);
    
    if ((tempColor.r + tempColor.g + tempColor.b) / 3.0 > 1.0) {
        //fragColor = vec3(0.0);
        fragColor *= 0.2;
    }
    //fragColor *= tempColor;
    
    const vec3 ambientLight = vec3(0.025);
    fragColor += albedo * ambientLight;
    gl_FragColor = vec4(fragColor, 1.0);
  }
  `;
}