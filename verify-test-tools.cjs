#!/usr/bin/env node

/**
 * 验证回归测试工具是否正确集成到 MCP 服务器中
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

async function verifyMCPTools() {
  console.log('🔍 验证 Playwright MCP 回归测试工具');
  console.log('');
  
  try {
    // 检查编译后的文件
    const distPath = path.join(__dirname, 'dist/index.js');
    if (!fs.existsSync(distPath)) {
      throw new Error('编译后的文件不存在，请运行 npm run build');
    }
    console.log('✅ 编译文件存在');
    
    // 检查测试目录
    const testDir = path.join(__dirname, 'generated-tests');
    if (fs.existsSync(testDir)) {
      console.log('✅ 测试生成目录已创建');
    } else {
      console.log('ℹ️  测试生成目录将在首次使用时创建');
    }
    
    // 启动 MCP 服务器并测试工具列表
    console.log('');
    console.log('🚀 启动 MCP 服务器测试...');
    
    const mcpServer = spawn('node', [distPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    // 发送工具列表请求
    const listToolsRequest = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list"
    }) + '\n';
    
    mcpServer.stdin.write(listToolsRequest);
    
    let responseData = '';
    
    mcpServer.stdout.on('data', (data) => {
      responseData += data.toString();
    });
    
    mcpServer.stderr.on('data', (data) => {
      console.log('MCP Server:', data.toString());
    });
    
    // 等待响应
    setTimeout(() => {
      mcpServer.kill();
      
      try {
        // 解析响应
        const lines = responseData.split('\n').filter(line => line.trim());
        const response = lines.find(line => {
          try {
            const parsed = JSON.parse(line);
            return parsed.result && parsed.result.tools;
          } catch (e) {
            return false;
          }
        });
        
        if (response) {
          const parsed = JSON.parse(response);
          const tools = parsed.result.tools;
          
          console.log(`✅ MCP 服务器响应正常，找到 ${tools.length} 个工具`);
          console.log('');
          
          // 检查回归测试工具
          const testTools = tools.filter(tool => tool.name.startsWith('test_'));
          console.log('🧪 回归测试相关工具:');
          testTools.forEach(tool => {
            console.log(`   📋 ${tool.name} - ${tool.description}`);
          });
          
          const expectedTestTools = [
            'test_start_recording',
            'test_stop_recording', 
            'test_generate_regression',
            'test_generate_suite',
            'test_list_recordings'
          ];
          
          const foundTestTools = testTools.map(t => t.name);
          const missingTools = expectedTestTools.filter(t => !foundTestTools.includes(t));
          
          if (missingTools.length === 0) {
            console.log('');
            console.log('🎉 所有回归测试工具都已正确集成！');
            
            // 显示使用示例
            console.log('');
            console.log('💡 使用示例：');
            console.log('');
            console.log('1. 启动浏览器会话:');
            console.log('   mcp__playwright__browser_launch({"sessionId": "test", "headless": true})');
            console.log('');
            console.log('2. 导航到页面:');
            console.log('   mcp__playwright__page_navigate({"sessionId": "test", "url": "https://example.com"})');
            console.log('');
            console.log('3. 生成回归测试:');
            console.log('   mcp__playwright__test_generate_regression({"sessionId": "test", "testName": "example_test"})');
            
          } else {
            console.error(`❌ 缺少工具: ${missingTools.join(', ')}`);
          }
          
        } else {
          console.error('❌ 无法获取工具列表响应');
        }
        
      } catch (error) {
        console.error('❌ 解析响应失败:', error.message);
        console.log('原始响应:', responseData);
      }
      
    }, 2000);
    
    mcpServer.on('error', (error) => {
      console.error('❌ MCP 服务器启动失败:', error.message);
    });
    
  } catch (error) {
    console.error('❌ 验证失败:', error.message);
  }
}

console.log('========================================');
console.log('   MCP 回归测试工具验证');
console.log('========================================\n');

verifyMCPTools().catch(console.error);